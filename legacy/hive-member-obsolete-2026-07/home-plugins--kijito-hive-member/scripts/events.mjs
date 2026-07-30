import fs from "node:fs";
import path from "node:path";

import { errorCode, writeJsonAtomic } from "./io.mjs";
import { classifyMessage, envelopeMessage } from "./safety.mjs";

const STATE_SCHEMA = 1;
const RECENT_LIMIT = 512;
const ACTION_LIMIT = 1024;
const MAX_EVENT_READ_BYTES = 8 * 1024 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;

export function defaultState(persona) {
  return {
    schemaVersion: STATE_SCHEMA,
    persona,
    lastHandledId: 0,
    fileDev: null,
    fileIno: null,
    offset: 0,
    recentHandledIds: [],
    actions: {},
    lastReconciledAt: null,
    reconcilePending: false,
    lastActionAt: null,
    lastError: null,
    stateBlocked: false,
  };
}

export function loadState(statePath, persona) {
  let fd = null;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(statePath, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())
      || (stat.mode & 0o077) !== 0) {
      throw Object.assign(new Error("bridge state file is unsafe"), {
        code: "state_file_unsafe",
      });
    }
    if (stat.size > MAX_STATE_BYTES) {
      throw Object.assign(new Error("bridge state file exceeds the size limit"), {
        code: "state_file_too_large",
      });
    }
    const parsed = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (parsed.persona !== persona) {
      return {
        ...defaultState(persona),
        lastError: "state_persona_mismatch",
        stateBlocked: true,
      };
    }
    if (parsed.schemaVersion !== STATE_SCHEMA) {
      return {
        ...defaultState(persona),
        lastError: "state_schema_mismatch",
        stateBlocked: true,
      };
    }
    const recentHandledIds = Array.isArray(parsed.recentHandledIds)
      ? parsed.recentHandledIds.map(Number)
      : [];
    const valid = Number.isSafeInteger(Number(parsed.lastHandledId || 0))
      && Number(parsed.lastHandledId || 0) >= 0
      && Number.isSafeInteger(Number(parsed.offset || 0))
      && Number(parsed.offset || 0) >= 0
      && (parsed.fileDev === null || parsed.fileDev === undefined
        || Number.isSafeInteger(Number(parsed.fileDev)))
      && (parsed.fileIno === null || parsed.fileIno === undefined
        || Number.isSafeInteger(Number(parsed.fileIno)))
      && recentHandledIds.every((id) => Number.isSafeInteger(id) && id > 0)
      && parsed.actions !== null
      && typeof parsed.actions === "object"
      && !Array.isArray(parsed.actions)
      && Object.keys(parsed.actions).length <= ACTION_LIMIT
      && Object.entries(parsed.actions).every(([key, action]) => (
        key.startsWith(`${persona}:`)
        && action !== null
        && typeof action === "object"
        && !Array.isArray(action)
        && typeof action.disposition === "string"
      ));
    if (!valid) {
      return {
        ...defaultState(persona),
        lastError: "invalid_state_shape",
        stateBlocked: true,
      };
    }
    return {
      ...defaultState(persona),
      ...parsed,
      lastHandledId: Number(parsed.lastHandledId || 0),
      offset: Number(parsed.offset || 0),
      recentHandledIds,
      actions: parsed.actions,
      reconcilePending: Boolean(parsed.reconcilePending),
      stateBlocked: Boolean(parsed.stateBlocked),
    };
  } catch (error) {
    if (error.code === "ENOENT") return defaultState(persona);
    return {
      ...defaultState(persona),
      lastError: error.code === "ELOOP"
        ? "state_file_unsafe"
        : error.code || "invalid_state_json",
      stateBlocked: true,
    };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function eventFileStat(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()
    || stat.isSymbolicLink()
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
    || (stat.mode & 0o022) !== 0) {
    throw Object.assign(new Error("event path is not a regular non-symlink file"), {
      code: "event_file_unsafe",
    });
  }
  return stat;
}

export function saveState(statePath, state) {
  writeJsonAtomic(statePath, state);
}

export function detectStaleSharedEventPath(eventPath, persona) {
  const base = path.basename(eventPath);
  return base === "events.ndjson"
    || (base.startsWith("events.") && !base.includes(`.${persona}.`));
}

function candidateAge(name, base) {
  if (name === base) return -1;
  const suffix = name.slice(base.length + 1);
  const numeric = Number(suffix);
  return Number.isInteger(numeric) ? numeric : 0;
}

export function archiveCandidates(eventPath) {
  const dir = path.dirname(eventPath);
  const base = path.basename(eventPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name === base || name.startsWith(`${base}.`))
    .sort((a, b) => candidateAge(b, base) - candidateAge(a, base))
    .map((name) => path.join(dir, name));
}

function readCompleteLines(file, startOffset = 0, maxBytes = MAX_EVENT_READ_BYTES) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags);
  const stat = fs.fstatSync(fd);
  if (!stat.isFile()
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
    || (stat.mode & 0o022) !== 0) {
    fs.closeSync(fd);
    throw Object.assign(new Error("event path is not a safe regular file"), {
      code: "event_file_unsafe",
    });
  }
  if (startOffset > stat.size) {
    fs.closeSync(fd);
    return {
      events: [],
      nextOffset: 0,
      parseErrors: 0,
      stat,
      truncated: true,
      oversized: false,
    };
  }
  const length = stat.size - startOffset;
  if (length > maxBytes) {
    fs.closeSync(fd);
    return {
      events: [],
      nextOffset: stat.size,
      parseErrors: 0,
      stat,
      truncated: false,
      oversized: true,
    };
  }
  if (length === 0) {
    fs.closeSync(fd);
    return {
      events: [],
      nextOffset: startOffset,
      parseErrors: 0,
      stat,
      truncated: false,
      oversized: false,
    };
  }
  let buffer;
  try {
    buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const read = fs.readSync(
        fd,
        buffer,
        bytesRead,
        length - bytesRead,
        startOffset + bytesRead,
      );
      if (read === 0) break;
      bytesRead += read;
    }
    buffer = buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline < 0) {
    return {
      events: [],
      nextOffset: startOffset,
      parseErrors: 0,
      stat,
      truncated: false,
      oversized: false,
    };
  }
  const complete = buffer.subarray(0, lastNewline + 1).toString("utf8");
  const events = [];
  let parseErrors = 0;
  for (const line of complete.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      parseErrors += 1;
    }
  }
  return {
    events,
    nextOffset: startOffset + lastNewline + 1,
    parseErrors,
    stat,
    truncated: false,
    oversized: false,
  };
}

export function loadNewEvents({ eventPath, state, persona }) {
  if (state.stateBlocked) {
    return {
      events: [],
      gapPossible: true,
      stalePath: false,
      parseErrors: 0,
      nextFileDev: state.fileDev,
      nextFileIno: state.fileIno,
      nextOffset: state.offset,
      error: state.lastError,
    };
  }
  if (detectStaleSharedEventPath(eventPath, persona)) {
    return {
      events: [],
      gapPossible: true,
      stalePath: true,
      parseErrors: 0,
      nextFileDev: null,
      nextFileIno: null,
      nextOffset: 0,
      error: "stale_shared_event_path",
    };
  }

  let liveStat;
  try {
    liveStat = eventFileStat(eventPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      events: [],
      gapPossible: true,
      stalePath: false,
      parseErrors: 0,
      nextFileDev: null,
      nextFileIno: null,
      nextOffset: 0,
      error: "event_file_missing",
    };
  }

  const sameFile = state.fileDev === liveStat.dev
    && state.fileIno === liveStat.ino
    && state.offset <= liveStat.size;
  if (sameFile) {
    const read = readCompleteLines(eventPath, state.offset);
    return {
      events: read.events,
      gapPossible: read.oversized,
      stalePath: false,
      parseErrors: read.parseErrors,
      nextFileDev: read.stat.dev,
      nextFileIno: read.stat.ino,
      nextOffset: read.nextOffset,
      error: read.oversized
        ? "event_chunk_too_large"
        : read.parseErrors
          ? "event_parse_error"
          : null,
    };
  }

  const events = [];
  const seen = new Set();
  let parseErrors = 0;
  let oversized = false;
  let nextOffset = 0;
  let nextLiveStat = liveStat;
  for (const candidate of archiveCandidates(eventPath)) {
    const read = readCompleteLines(candidate, 0);
    parseErrors += read.parseErrors;
    oversized ||= read.oversized;
    if (candidate === eventPath) {
      nextOffset = read.nextOffset;
      nextLiveStat = read.stat;
    }
    for (const event of read.events) {
      const id = Number(event.id || 0);
      if (!id || id <= state.lastHandledId || seen.has(id)) continue;
      seen.add(id);
      events.push(event);
    }
  }
  events.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  return {
    events,
    gapPossible: true,
    stalePath: false,
    parseErrors,
    nextFileDev: nextLiveStat.dev,
    nextFileIno: nextLiveStat.ino,
    nextOffset,
    error: oversized
      ? "event_chunk_too_large"
      : parseErrors
        ? "event_parse_error"
        : null,
  };
}

export function normalizeInboxMessage(message, persona) {
  return {
    event: "new",
    source: "kijito-api-reconcile",
    id: message.id,
    from: message.from || message.sender,
    created: message.created,
    persona,
    content: message.content || message.body || "",
    urgent: Boolean(message.urgent),
    actionable: Boolean(message.actionable),
  };
}

export function mergeReconciledEvents(events, messages, persona, state) {
  const byId = new Map();
  for (const event of events) {
    const id = Number(event.id || 0);
    if (id > state.lastHandledId) byId.set(id, event);
  }
  for (const message of messages || []) {
    const event = normalizeInboxMessage(message, persona);
    const id = Number(event.id || 0);
    if (id > state.lastHandledId) byId.set(id, event);
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function trimActions(actions) {
  const entries = Object.entries(actions);
  if (entries.length <= ACTION_LIMIT) return actions;
  return Object.fromEntries(entries.slice(-ACTION_LIMIT));
}

export function handleEvents({
  events,
  state,
  persona,
  policy,
  selfAuthors = [persona],
}) {
  const notices = [];
  const actions = [];
  const recent = new Set(state.recentHandledIds);
  const self = new Set(selfAuthors);

  for (const event of events) {
    const id = Number(event.id || 0);
    if (!Number.isSafeInteger(id) || id <= 0 || event.event !== "new") continue;
    if ((event.persona || event._persona) && (event.persona || event._persona) !== persona) continue;
    const actionKey = `${persona}:${id}`;
    if (state.actions[actionKey] || recent.has(id)) continue;

    state.lastHandledId = Math.max(state.lastHandledId, id);
    recent.add(id);
    if (self.has(event.from || event.sender)) {
      state.actions[actionKey] = {
        disposition: "self_suppressed",
        at: new Date().toISOString(),
      };
      continue;
    }

    const classification = classifyMessage(event, policy);
    const envelope = envelopeMessage(event, classification);
    const notice = { actionKey, id, persona, classification, envelope };
    notices.push(notice);
    const actionRequired = classification.shouldWake || classification.autoSendAllowed;
    if (actionRequired) {
      actions.push(notice);
    }
    state.actions[actionKey] = {
      disposition: actionRequired ? "pending_draft" : "surface_only",
      mode: classification.mode,
      reason: classification.reason,
      at: new Date().toISOString(),
    };
  }

  state.recentHandledIds = [...recent].slice(-RECENT_LIMIT);
  state.actions = trimActions(state.actions);
  return { notices, actions };
}

export function consumeOnce({
  eventPath,
  statePath,
  persona = "codex",
  policy,
  selfAuthors = [persona],
  reconciledMessages = [],
  reconciliationAttempted = false,
}) {
  const state = loadState(statePath, persona);
  if (state.stateBlocked) {
    return {
      notices: [],
      actions: [],
      loaded: {
        events: [],
        gapPossible: true,
        stalePath: false,
        error: state.lastError,
      },
      state,
    };
  }
  let loaded;
  try {
    loaded = loadNewEvents({ eventPath, state, persona });
  } catch (error) {
    loaded = {
      events: [],
      gapPossible: true,
      stalePath: false,
      parseErrors: 0,
      nextFileDev: state.fileDev,
      nextFileIno: state.fileIno,
      nextOffset: state.offset,
      error: errorCode(error),
    };
  }
  const events = mergeReconciledEvents(loaded.events, reconciledMessages, persona, state);
  const handled = handleEvents({ events, state, persona, policy, selfAuthors });
  state.fileDev = loaded.nextFileDev;
  state.fileIno = loaded.nextFileIno;
  state.offset = loaded.nextOffset;
  state.lastError = loaded.stalePath ? "stale_shared_event_path" : loaded.error;
  state.reconcilePending = Boolean(state.reconcilePending || loaded.gapPossible);
  if (reconciliationAttempted) {
    state.lastReconciledAt = new Date().toISOString();
    state.reconcilePending = false;
  }
  saveState(statePath, state);
  return { ...handled, loaded: { ...loaded, events }, state };
}

export function updateActionState(statePath, persona, actionKey, patch) {
  const state = loadState(statePath, persona);
  if (state.stateBlocked) return state;
  if (!state.actions[actionKey]) {
    state.actions[actionKey] = { disposition: "unknown" };
  }
  state.actions[actionKey] = {
    ...state.actions[actionKey],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  state.lastActionAt = new Date().toISOString();
  state.actions = trimActions(state.actions);
  saveState(statePath, state);
  return state;
}

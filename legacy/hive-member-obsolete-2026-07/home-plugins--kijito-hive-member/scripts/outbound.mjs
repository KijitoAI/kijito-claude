import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadState, updateActionState } from "./events.mjs";
import { readJson, writeJsonAtomic } from "./io.mjs";
import { sendMessage } from "./kijito-api.mjs";
import { deterministicAutoReply, validPersonaName } from "./safety.mjs";

const LEDGER_SCHEMA = 1;
const MAX_DRAFT_ARTIFACT_BYTES = 256 * 1024;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_LEDGER_ENTRIES = 10000;
const TERMINAL_DISPOSITIONS = new Set([
  "sent",
  "send_reserved",
  "send_ambiguous",
]);

function digestPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function outboundMetadata(payload, digest) {
  return {
    digest,
    from: payload.from,
    to: payload.to,
    sourceMessageId: payload.sourceMessageId,
    messageClass: payload.messageClass,
    urgent: payload.urgent,
  };
}

function assertOutboundPayload(payload, policy) {
  if (!policy.outbound?.enabled) {
    throw Object.assign(new Error("outbound sending is disabled"), {
      code: "outbound_disabled",
    });
  }
  if (!validPersonaName(payload.from) || !validPersonaName(payload.to)) {
    throw Object.assign(new Error("outbound persona is invalid"), {
      code: "outbound_persona_invalid",
    });
  }
  if (!Number.isSafeInteger(payload.sourceMessageId) || payload.sourceMessageId <= 0) {
    throw Object.assign(new Error("outbound source message id is invalid"), {
      code: "invalid_message_id",
    });
  }
  if (typeof payload.content !== "string") {
    throw Object.assign(new Error("outbound content is invalid"), {
      code: "outbound_content_invalid",
    });
  }
  const bytes = Buffer.byteLength(payload.content, "utf8");
  const maxBytes = Number(policy.outbound.maxContentBytes || 4096);
  if (bytes < 1 || bytes > maxBytes || /[\u0000\u0008\u000B\u000C]/.test(payload.content)) {
    throw Object.assign(new Error("outbound content is invalid"), {
      code: "outbound_content_invalid",
    });
  }
}

export function buildAutoSendPayload({ action, persona, policy }) {
  const metadata = action?.envelope?.trustedMetadata || {};
  const classification = action?.classification;
  const payload = {
    from: persona,
    to: String(metadata.from || ""),
    content: deterministicAutoReply({
      id: metadata.id,
      from: metadata.from,
    }, classification, policy),
    urgent: false,
    sourceMessageId: Number(metadata.id),
    messageClass: classification.messageClass,
    authorization: "local_exact_auto_send_rule",
  };
  assertOutboundPayload(payload, policy);
  if (!(policy.autoSend.allowedSenders || []).includes(payload.to)
    || !(policy.autoSend.allowedClasses || []).includes(payload.messageClass)) {
    throw Object.assign(new Error("auto-send allow rule no longer matches"), {
      code: "auto_send_rule_mismatch",
    });
  }
  return payload;
}

function reserveBridgeSend({ statePath, persona, actionKey, payload }) {
  const state = loadState(statePath, persona);
  if (state.stateBlocked) {
    throw Object.assign(new Error("bridge state is blocked"), {
      code: state.lastError || "state_blocked",
    });
  }
  const current = state.actions[actionKey];
  if (!current) {
    throw Object.assign(new Error("bridge action is missing"), {
      code: "outbound_action_missing",
    });
  }
  if (TERMINAL_DISPOSITIONS.has(current.disposition)) {
    throw Object.assign(new Error("outbound action was already reserved or completed"), {
      code: "outbound_duplicate_blocked",
    });
  }
  const digest = digestPayload(payload);
  updateActionState(statePath, persona, actionKey, {
    disposition: "send_reserved",
    outbound: outboundMetadata(payload, digest),
    sendAllowed: true,
  });
  return digest;
}

export async function sendAutoReply({
  action,
  persona,
  policy,
  statePath,
  tokenFile,
  sendImpl = sendMessage,
}) {
  const payload = buildAutoSendPayload({ action, persona, policy });
  const dataDir = path.dirname(statePath);
  const digest = reserveLedgerEntry({
    dataDir,
    payload,
    authorization: payload.authorization,
  });
  try {
    reserveBridgeSend({
      statePath,
      persona,
      actionKey: action.actionKey,
      payload,
    });
  } catch (error) {
    completeLedgerEntry({
      dataDir,
      digest,
      status: "blocked_before_send",
      error: error.code || "outbound_reservation_failed",
    });
    throw error;
  }

  let sent;
  try {
    sent = await sendImpl({
      to: payload.to,
      from: payload.from,
      content: payload.content,
      urgent: payload.urgent,
      tokenFile,
      timeoutMs: Number(policy.outbound.requestTimeoutMs || 10000),
      responseLimitBytes: Number(policy.outbound.responseLimitBytes || 1024 * 1024),
      maxContentBytes: Number(policy.outbound.maxContentBytes || 4096),
    });
  } catch (error) {
    completeLedgerEntry({
      dataDir,
      digest,
      status: "send_ambiguous",
      error: error.code || "kijito_send_failed",
    });
    updateActionState(statePath, persona, action.actionKey, {
      disposition: "send_ambiguous",
      outbound: outboundMetadata(payload, digest),
      sendAllowed: true,
      error: error.code || "kijito_send_failed",
    });
    throw Object.assign(error, {
      code: error.code || "kijito_send_failed",
      outboundDisposition: "send_ambiguous",
    });
  }

  try {
    completeLedgerEntry({
      dataDir,
      digest,
      status: "sent",
      sentMessageId: sent.id,
    });
  } catch (error) {
    updateActionState(statePath, persona, action.actionKey, {
      disposition: "send_ambiguous",
      outbound: outboundMetadata(payload, digest),
      sendAllowed: true,
      error: error.code || "outbound_ledger_completion_failed",
    });
    throw Object.assign(error, {
      code: error.code || "outbound_ledger_completion_failed",
      outboundDisposition: "send_ambiguous",
    });
  }
  updateActionState(statePath, persona, action.actionKey, {
    disposition: "sent",
    outbound: {
      ...outboundMetadata(payload, digest),
      sentMessageId: sent.id,
    },
    sendAllowed: true,
  });
  return {
    status: "sent",
    id: action.id,
    sentMessageId: sent.id,
    to: sent.to,
    digest,
  };
}

function readPrivateRegularFile(file) {
  let fd = null;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(file, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw Object.assign(new Error("draft must be a regular non-symlink file"), {
        code: "draft_file_unsafe",
      });
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw Object.assign(new Error("draft is not owned by the current user"), {
        code: "draft_owner_mismatch",
      });
    }
    if ((stat.mode & 0o077) !== 0) {
      throw Object.assign(new Error("draft permissions are not private"), {
        code: "draft_permissions_unsafe",
      });
    }
    if (stat.size > MAX_DRAFT_ARTIFACT_BYTES) {
      throw Object.assign(new Error("draft artifact exceeds the size limit"), {
        code: "draft_file_too_large",
      });
    }
    return fs.readFileSync(fd, "utf8");
  } catch (error) {
    if (error.code === "ELOOP") {
      throw Object.assign(new Error("draft must be a regular non-symlink file"), {
        code: "draft_file_unsafe",
      });
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function assertDraftPathContained({ draftPath, dataDir }) {
  const draftsRoot = fs.realpathSync(path.join(dataDir, "drafts"));
  const realDraft = fs.realpathSync(draftPath);
  const relative = path.relative(draftsRoot, realDraft);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("draft is outside the connector draft directory"), {
      code: "draft_path_outside_data_dir",
    });
  }
  return realDraft;
}

export function loadManualDraft({ draftPath, dataDir, persona, policy }) {
  const realDraft = assertDraftPathContained({ draftPath, dataDir });
  const artifact = JSON.parse(readPrivateRegularFile(draftPath));
  if (artifact.schemaVersion !== 2
    || artifact.result?.status !== "drafted"
    || artifact.result?.draftValidated !== true
    || artifact.result?.rawFallbackUsed
    || Number(artifact.result?.toolActivityCount || 0) !== 0
    || Number(artifact.result?.serverRequestsRefused || 0) !== 0
    || artifact.result?.mcpServerCount !== 0
    || artifact.result?.hookSourceCount !== 0
    || artifact.result?.draft?.sendAllowed !== false
    || typeof artifact.result?.draft?.draftReply !== "string") {
    throw Object.assign(new Error("draft is not eligible for manual sending"), {
      code: "draft_not_sendable",
    });
  }
  const metadata = artifact.message?.trustedMetadata || {};
  if (metadata.persona !== persona) {
    throw Object.assign(new Error("draft persona does not match the sending persona"), {
      code: "draft_persona_mismatch",
    });
  }
  const payload = {
    from: persona,
    to: String(metadata.from || ""),
    content: String(artifact.result.draft?.draftReply || ""),
    urgent: false,
    sourceMessageId: Number(metadata.id),
    messageClass: "user_reviewed_model_draft",
    authorization: "local_tty_exact_phrase",
    draftCreatedAt: String(artifact.createdAt || ""),
  };
  assertOutboundPayload(payload, policy);
  return {
    artifact,
    payload,
    digest: digestPayload(payload),
    actionKey: `${persona}:${payload.sourceMessageId}`,
    realDraft,
  };
}

export function approvalPhrase(proposal) {
  return `SEND ${proposal.payload.sourceMessageId} ${proposal.digest.slice(0, 12)} TO ${proposal.payload.to}`;
}

function acquireLedgerLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n`);
    return () => {
      try {
        fs.closeSync(fd);
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    } catch {
      // An unreadable lock is preserved as stale below.
    }
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        throw Object.assign(new Error("another outbound operation is active"), {
          code: "outbound_lock_busy",
        });
      } catch (probeError) {
        if (probeError.code === "outbound_lock_busy") throw probeError;
        if (probeError.code !== "ESRCH") throw probeError;
      }
    }
    fs.renameSync(lockPath, `${lockPath}.stale.${Date.now()}`);
    return acquireLedgerLock(lockPath);
  }
}

function ledgerDefault() {
  return { schemaVersion: LEDGER_SCHEMA, entries: {} };
}

function loadLedger(file) {
  try {
    if (fs.statSync(file).size > MAX_LEDGER_BYTES) {
      throw Object.assign(new Error("outbound ledger exceeds the size limit"), {
        code: "outbound_ledger_too_large",
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const ledger = readJson(file, ledgerDefault());
  if (ledger?.schemaVersion !== LEDGER_SCHEMA
    || ledger.entries === null
    || typeof ledger.entries !== "object"
    || Array.isArray(ledger.entries)) {
    throw Object.assign(new Error("outbound ledger is invalid"), {
      code: "outbound_ledger_invalid",
    });
  }
  if (Object.keys(ledger.entries).length > MAX_LEDGER_ENTRIES) {
    throw Object.assign(new Error("outbound ledger entry limit was exceeded"), {
      code: "outbound_ledger_capacity_exceeded",
    });
  }
  return ledger;
}

function reserveLedgerEntry({ dataDir, payload, authorization }) {
  const ledgerPath = path.join(dataDir, "outbound-ledger.json");
  const release = acquireLedgerLock(path.join(dataDir, "outbound-ledger.lock"));
  try {
    const ledger = loadLedger(ledgerPath);
    const digest = digestPayload(payload);
    if (ledger.entries[digest]) {
      throw Object.assign(new Error("this exact outbound payload was already attempted"), {
        code: "outbound_duplicate_blocked",
      });
    }
    if (Object.keys(ledger.entries).length >= MAX_LEDGER_ENTRIES) {
      throw Object.assign(new Error("outbound ledger entry limit was reached"), {
        code: "outbound_ledger_capacity_exceeded",
      });
    }
    ledger.entries[digest] = {
      status: "sending",
      at: new Date().toISOString(),
      ...outboundMetadata(payload, digest),
      authorization,
    };
    writeJsonAtomic(ledgerPath, ledger);
    return digest;
  } finally {
    release();
  }
}

function completeLedgerEntry({
  dataDir,
  digest,
  status,
  sentMessageId = null,
  error = null,
}) {
  const ledgerPath = path.join(dataDir, "outbound-ledger.json");
  const release = acquireLedgerLock(path.join(dataDir, "outbound-ledger.lock"));
  try {
    const ledger = loadLedger(ledgerPath);
    if (!ledger.entries[digest] || ledger.entries[digest].status !== "sending") {
      throw Object.assign(new Error("outbound ledger reservation is missing"), {
        code: "outbound_ledger_reservation_missing",
      });
    }
    ledger.entries[digest] = {
      ...ledger.entries[digest],
      status,
      completedAt: new Date().toISOString(),
      ...(sentMessageId ? { sentMessageId } : {}),
      ...(error ? { error } : {}),
    };
    writeJsonAtomic(ledgerPath, ledger);
  } finally {
    release();
  }
}

export async function sendManualDraft({
  draftPath,
  dataDir,
  persona,
  policy,
  tokenFile,
  enteredApprovalPhrase,
  sendImpl = sendMessage,
}) {
  if (policy.outbound?.manualApprovalRequiredForModelDrafts !== true) {
    throw Object.assign(new Error("manual approval policy is invalid"), {
      code: "manual_approval_policy_invalid",
    });
  }
  const proposal = loadManualDraft({ draftPath, dataDir, persona, policy });
  const expected = approvalPhrase(proposal);
  const entered = String(enteredApprovalPhrase || "");
  const expectedBytes = Buffer.from(expected);
  const enteredBytes = Buffer.from(entered);
  if (expectedBytes.length !== enteredBytes.length
    || !crypto.timingSafeEqual(expectedBytes, enteredBytes)) {
    throw Object.assign(new Error("approval phrase did not match this exact draft"), {
      code: "manual_approval_mismatch",
    });
  }

  const ledgerPath = path.join(dataDir, "outbound-ledger.json");
  const release = acquireLedgerLock(path.join(dataDir, "outbound-ledger.lock"));
  try {
    const ledger = loadLedger(ledgerPath);
    if (ledger.entries[proposal.digest]) {
      throw Object.assign(new Error("this exact draft was already attempted"), {
        code: "outbound_duplicate_blocked",
      });
    }
    if (Object.keys(ledger.entries).length >= MAX_LEDGER_ENTRIES) {
      throw Object.assign(new Error("outbound ledger entry limit was reached"), {
        code: "outbound_ledger_capacity_exceeded",
      });
    }
    ledger.entries[proposal.digest] = {
      status: "sending",
      at: new Date().toISOString(),
      ...outboundMetadata(proposal.payload, proposal.digest),
      authorization: "local_tty_exact_phrase",
    };
    writeJsonAtomic(ledgerPath, ledger);

    try {
      const sent = await sendImpl({
        to: proposal.payload.to,
        from: proposal.payload.from,
        content: proposal.payload.content,
        urgent: false,
        tokenFile,
        timeoutMs: Number(policy.outbound.requestTimeoutMs || 10000),
        responseLimitBytes: Number(policy.outbound.responseLimitBytes || 1024 * 1024),
        maxContentBytes: Number(policy.outbound.maxContentBytes || 4096),
      });
      ledger.entries[proposal.digest] = {
        ...ledger.entries[proposal.digest],
        status: "sent",
        completedAt: new Date().toISOString(),
        sentMessageId: sent.id,
      };
      writeJsonAtomic(ledgerPath, ledger);
      return {
        status: "sent",
        sentMessageId: sent.id,
        to: sent.to,
        digest: proposal.digest,
      };
    } catch (error) {
      ledger.entries[proposal.digest] = {
        ...ledger.entries[proposal.digest],
        status: "send_ambiguous",
        completedAt: new Date().toISOString(),
        error: error.code || "kijito_send_failed",
      };
      writeJsonAtomic(ledgerPath, ledger);
      throw Object.assign(error, {
        code: error.code || "kijito_send_failed",
        outboundDisposition: "send_ambiguous",
      });
    }
  } finally {
    release();
  }
}

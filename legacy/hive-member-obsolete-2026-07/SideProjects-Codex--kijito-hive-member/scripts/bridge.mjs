#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { draftWithAppServer } from "./app-server-client.mjs";
import {
  consumeOnce,
  saveState,
  updateActionState,
} from "./events.mjs";
import { ensurePrivateDir, errorCode, writeJsonAtomic } from "./io.mjs";
import { fetchInbox } from "./kijito-api.mjs";
import { loadSafetyPolicy, validPersonaName } from "./safety.mjs";
import { sendAutoReply } from "./outbound.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.dirname(scriptDir);

function parseArgs(argv) {
  const options = {
    mode: "once",
    dryRun: false,
    reconcile: false,
    persona: process.env.KIJITO_PERSONA || "codex",
    project: process.env.KIJITO_PROJECT || "Codex",
    pollMs: Number(process.env.KIJITO_CODEX_POLL_MS || 3000),
    eventPath: process.env.KIJITO_EVENTS_FILE || null,
    dataDir: process.env.KIJITO_CODEX_DATA_DIR || process.env.PLUGIN_DATA || null,
    tokenFile: process.env.KIJITO_TOKEN_FILE || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--watch") options.mode = "watch";
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--reconcile") options.reconcile = true;
    else if (arg === "--persona") options.persona = argv[++i];
    else if (arg === "--project") options.project = argv[++i];
    else if (arg === "--poll-ms") options.pollMs = Number(argv[++i]);
    else if (arg === "--event-path") options.eventPath = argv[++i];
    else if (arg === "--data-dir") options.dataDir = argv[++i];
    else if (arg === "--token-file") options.tokenFile = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!validPersonaName(options.persona)) {
    throw Object.assign(new Error("persona is invalid"), {
      code: "invalid_persona",
    });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$/.test(String(options.project || ""))) {
    throw Object.assign(new Error("project is invalid"), {
      code: "invalid_project",
    });
  }
  if (!Number.isFinite(options.pollMs) || options.pollMs < 250) {
    throw new Error("poll interval must be at least 250ms");
  }
  options.eventPath ||= path.join(
    os.homedir(),
    ".cache",
    "kijito-inbox-monitor",
    `events.${options.persona}.ndjson`,
  );
  options.dataDir ||= path.join(os.homedir(), ".cache", "kijito-codex-bridge");
  options.tokenFile ||= path.join(
    os.homedir(),
    ".config",
    "kijito-inbox-monitor",
    "token",
  );
  return options;
}

function pathsFor(options) {
  if (!validPersonaName(options.persona)) {
    throw Object.assign(new Error("persona is invalid"), {
      code: "invalid_persona",
    });
  }
  return {
    statePath: path.join(options.dataDir, `bridge-state.${options.persona}.json`),
    registryPath: path.join(options.dataDir, "thread-registry.json"),
    runStatusPath: path.join(options.dataDir, "last-run.json"),
    draftsDir: path.join(options.dataDir, "drafts"),
    lockPath: path.join(options.dataDir, `bridge.${options.persona}.lock`),
  };
}

function acquireLock(lockPath) {
  ensurePrivateDir(path.dirname(lockPath));
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n`);
    return () => {
      try {
        fs.closeSync(fd);
      } catch {
        // Already closed.
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let existingPid = 0;
    try {
      existingPid = Number(fs.readFileSync(lockPath, "utf8").trim());
    } catch {
      // Treat unreadable lock as stale and preserve it below.
    }
    if (existingPid > 0) {
      try {
        process.kill(existingPid, 0);
        throw Object.assign(new Error(`bridge already running as pid ${existingPid}`), {
          code: "bridge_already_running",
        });
      } catch (probeError) {
        if (probeError.code === "bridge_already_running") throw probeError;
        if (probeError.code !== "ESRCH") throw probeError;
      }
    }
    const preserved = `${lockPath}.stale.${Date.now()}`;
    fs.renameSync(lockPath, preserved);
    return acquireLock(lockPath);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reconcileIfNeeded({ options, result, policy, statePath }) {
  if (!options.reconcile && !result.loaded.gapPossible && !result.state.reconcilePending) {
    return result;
  }
  const inbox = await fetchInbox({
    persona: options.persona,
    tokenFile: options.tokenFile,
  });
  if (!inbox.available) {
    result.state.lastError = inbox.error;
    result.state.reconcilePending = true;
    saveState(statePath, result.state);
    return result;
  }
  const reconciled = consumeOnce({
    eventPath: options.eventPath,
    statePath,
    persona: options.persona,
    policy,
    reconciledMessages: inbox.messages,
    reconciliationAttempted: true,
  });
  return {
    ...reconciled,
    notices: [...result.notices, ...reconciled.notices],
    actions: [...result.actions, ...reconciled.actions],
  };
}

async function draftAction({
  action,
  options,
  paths,
  policy,
  draftImpl = draftWithAppServer,
  autoSendImpl = sendAutoReply,
}) {
  if (options.dryRun) {
    updateActionState(paths.statePath, options.persona, action.actionKey, {
      disposition: "dry_run",
      sendAllowed: false,
    });
    return { status: "dry_run", id: action.id };
  }

  const attempts = Number(policy.appServer?.maxAttempts || 3);
  let lastError = null;
  let result = null;
  let successfulAttempt = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      result = await draftImpl({
        envelope: action.envelope,
        persona: options.persona,
        project: options.project,
        registryPath: paths.registryPath,
        timeoutMs: Number(policy.appServer?.turnTimeoutMs || 120000),
      });
      successfulAttempt = attempt;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(250 * (2 ** (attempt - 1)));
    }
  }
  if (result) {
    ensurePrivateDir(paths.draftsDir);
    const draftPath = path.join(paths.draftsDir, `draft-${options.persona}-${action.id}.json`);
    writeJsonAtomic(draftPath, {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      message: action.envelope,
      result,
      policy: {
        defaultMode: policy.defaultMode,
        autoSendEnabled: Boolean(policy.autoSend?.enabled),
        autoSendEligible: Boolean(action.classification.autoSendAllowed),
        modelDraftSendAllowed: false,
        manualApprovalRequired: true,
      },
    });
    updateActionState(paths.statePath, options.persona, action.actionKey, {
      disposition: "drafted",
      draftPath,
      model: result.model,
      threadId: result.threadId,
      turnId: result.turnId,
      sendAllowed: false,
      attempts: successfulAttempt,
    });
    if (action.classification.autoSendAllowed) {
      try {
        return {
          ...(await autoSendImpl({
            action,
            persona: options.persona,
            policy,
            statePath: paths.statePath,
            tokenFile: options.tokenFile,
          })),
          draftPath,
        };
      } catch (error) {
        return {
          status: error.outboundDisposition === "send_ambiguous"
            ? "send_ambiguous"
            : "send_blocked",
          id: action.id,
          draftPath,
          error: errorCode(error),
        };
      }
    }
    return { status: "drafted", id: action.id, draftPath };
  }
  updateActionState(paths.statePath, options.persona, action.actionKey, {
    disposition: "draft_failed",
    error: errorCode(lastError),
    sendAllowed: false,
    attempts,
  });
  return { status: "draft_failed", id: action.id, error: errorCode(lastError) };
}

async function runOnceUnlocked(options, dependencies = {}) {
  const paths = pathsFor(options);
  ensurePrivateDir(options.dataDir);
  const policy = loadSafetyPolicy(path.join(pluginRoot, "scripts", "safety-policy.json"));
  let consumed = consumeOnce({
    eventPath: options.eventPath,
    statePath: paths.statePath,
    persona: options.persona,
    policy,
  });
  consumed = await reconcileIfNeeded({
    options,
    result: consumed,
    policy,
    statePath: paths.statePath,
  });

  const actionResults = [];
  for (const action of consumed.actions) {
    actionResults.push(await draftAction({
      action,
      options,
      paths,
      policy,
      draftImpl: dependencies.draftImpl,
      autoSendImpl: dependencies.autoSendImpl,
    }));
  }
  const status = {
    schemaVersion: 1,
    at: new Date().toISOString(),
    persona: options.persona,
    project: options.project,
    eventPath: options.eventPath,
    noticeCount: consumed.notices.length,
    actionCount: consumed.actions.length,
    draftedCount: actionResults.filter((result) => result.status === "drafted").length,
    sentCount: actionResults.filter((result) => result.status === "sent").length,
    ambiguousSendCount: actionResults.filter(
      (result) => result.status === "send_ambiguous",
    ).length,
    blockedSendCount: actionResults.filter(
      (result) => result.status === "send_blocked",
    ).length,
    failedCount: actionResults.filter(
      (result) => ["draft_failed", "send_ambiguous", "send_blocked"].includes(result.status),
    ).length,
    gapPossible: Boolean(consumed.loaded.gapPossible),
    reconciledAt: consumed.state.lastReconciledAt,
    lastHandledId: consumed.state.lastHandledId,
    lastError: consumed.state.lastError,
    dryRun: options.dryRun,
  };
  writeJsonAtomic(paths.runStatusPath, status);
  return { status, actionResults };
}

export async function runOnce(options, dependencies = {}) {
  const releaseLock = acquireLock(pathsFor(options).lockPath);
  try {
    return await runOnceUnlocked(options, dependencies);
  } finally {
    releaseLock();
  }
}

async function watch(options) {
  const paths = pathsFor(options);
  const releaseLock = acquireLock(paths.lockPath);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    while (!stopping) {
      try {
        await runOnceUnlocked(options);
      } catch (error) {
        writeJsonAtomic(paths.runStatusPath, {
          schemaVersion: 1,
          at: new Date().toISOString(),
          persona: options.persona,
          project: options.project,
          lastError: errorCode(error),
          failedCount: 1,
        });
      }
      if (!stopping) await delay(options.pollMs);
    }
  } finally {
    releaseLock();
  }
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === "watch") {
      await watch(options);
    } else {
      const result = await runOnce(options);
      process.stdout.write(`${JSON.stringify(result.status, null, 2)}\n`);
      if (result.status.failedCount) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${errorCode(error)}\n`);
    process.exitCode = 1;
  }
}

export { draftAction, parseArgs, pathsFor };

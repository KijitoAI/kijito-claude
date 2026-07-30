#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appServerDiagnostics } from "./app-server-client.mjs";
import { loadNewEvents, loadState } from "./events.mjs";
import { fileStat, readJson, redactForDiagnostics } from "./io.mjs";
import { fetchUnreadCounts } from "./kijito-api.mjs";
import { loadSafetyPolicy, validPersonaName } from "./safety.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.dirname(scriptDir);
const pluginData = process.env.PLUGIN_DATA || process.env.KIJITO_CODEX_DATA_DIR || path.join(
  os.homedir(),
  ".cache",
  "kijito-codex-bridge",
);

function commandStatus(command, args, timeout = 5000, env = process.env) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: redactForDiagnostics(result.stdout).trim(),
    stderr: redactForDiagnostics(result.stderr).trim(),
    error: result.error?.code || null,
  };
}

function launchAgentStatus(label) {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return { supported: false, running: null };
  }
  const result = commandStatus("launchctl", [
    "print",
    `gui/${process.getuid()}/${label}`,
  ]);
  return {
    supported: true,
    running: result.ok && /\bstate = running\b/.test(result.stdout),
    loaded: result.ok,
    error: result.ok ? null : result.error || "not_loaded",
  };
}

function lifecycleHookStatus(file) {
  const required = [
    "SessionStart",
    "UserPromptSubmit",
    "PreCompact",
    "PostCompact",
    "Stop",
  ];
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const available = Object.fromEntries(required.map((eventName) => [
      eventName,
      Array.isArray(manifest?.hooks?.[eventName])
        && manifest.hooks[eventName].length > 0,
    ]));
    return {
      valid: Object.values(available).every(Boolean),
      available,
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      available: Object.fromEntries(required.map((eventName) => [eventName, false])),
      error: error.code || "hook_manifest_invalid",
    };
  }
}

const persona = process.env.KIJITO_PERSONA || "codex";
if (!validPersonaName(persona)) {
  throw Object.assign(new Error("persona is invalid"), {
    code: "invalid_persona",
  });
}
const eventPath = process.env.KIJITO_EVENTS_FILE || path.join(
  os.homedir(),
  ".cache",
  "kijito-inbox-monitor",
  `events.${persona}.ndjson`,
);
const statePath = path.join(pluginData, `bridge-state.${persona}.json`);
const runStatusPath = path.join(pluginData, "last-run.json");
const outboundLedgerPath = path.join(pluginData, "outbound-ledger.json");
const tokenFile = process.env.KIJITO_TOKEN_FILE || path.join(
  os.homedir(),
  ".config",
  "kijito-inbox-monitor",
  "token",
);
const safetyPolicy = loadSafetyPolicy(path.join(pluginRoot, "scripts", "safety-policy.json"));

const state = loadState(statePath, persona);
let pendingEventCount = null;
let eventScanError = null;
try {
  const loaded = loadNewEvents({ eventPath, state, persona });
  pendingEventCount = loaded.events.filter((event) => event.event === "new").length;
  eventScanError = loaded.error;
} catch (error) {
  eventScanError = error.code || "event_scan_failed";
}

const unread = await fetchUnreadCounts({ tokenFile });
const appServer = await appServerDiagnostics({
  isolationRoot: path.join(pluginData, "app-server-isolation"),
});
const codexCommand = process.env.KIJITO_CODEX_COMMAND || "codex";
const cliVersion = commandStatus(codexCommand, ["--version"]);
const daemonVersion = commandStatus(codexCommand, ["app-server", "daemon", "version"]);
const hookManifestPath = path.join(pluginRoot, "hooks", "hooks.json");
const lifecycleHooks = lifecycleHookStatus(hookManifestPath);
const hookRuntimeResult = commandStatus("/bin/sh", [
  path.join(pluginRoot, "scripts", "run-node.sh"),
  path.join(pluginRoot, "scripts", "context-status.mjs"),
], 5000, {
  ...process.env,
  CODEX_THREAD_ID: "",
  CODEX_TRANSCRIPT_PATH: "",
});
const hookRuntime = {
  ok: hookRuntimeResult.ok,
  status: hookRuntimeResult.status,
  signal: hookRuntimeResult.signal,
  error: hookRuntimeResult.error,
  stderr: hookRuntimeResult.stderr,
};
let lastRun = null;
let lastRunError = null;
try {
  lastRun = readJson(runStatusPath, null);
} catch {
  lastRunError = "last_run_invalid";
}
const bridgeAgent = launchAgentStatus("com.kijito.codex-hive-bridge");
const monitorAgent = launchAgentStatus("com.kijito.inbox-monitor");
const actionDispositionCounts = Object.values(state.actions || {}).reduce((counts, action) => {
  const disposition = String(action?.disposition || "unknown");
  counts[disposition] = (counts[disposition] || 0) + 1;
  return counts;
}, {});
let outboundLedger = null;
let outboundLedgerError = null;
try {
  outboundLedger = readJson(outboundLedgerPath, { schemaVersion: 1, entries: {} });
  if (outboundLedger?.schemaVersion !== 1
    || outboundLedger.entries === null
    || typeof outboundLedger.entries !== "object"
    || Array.isArray(outboundLedger.entries)) {
    outboundLedgerError = "outbound_ledger_invalid";
  }
} catch {
  outboundLedgerError = "outbound_ledger_invalid";
}
const outboundLedgerCounts = Object.values(outboundLedger?.entries || {}).reduce(
  (counts, entry) => {
    const status = String(entry?.status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  },
  {},
);

const report = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  persona,
  privacy: "No message body or draft content is included.",
  plugin: {
    root: pluginRoot,
    data: pluginData,
    manifest: fileStat(path.join(pluginRoot, ".codex-plugin", "plugin.json")),
    hooks: fileStat(hookManifestPath),
    lifecycleHooks,
    hookRuntime,
    hookTrust: "inspect interactively with /hooks; this process cannot self-approve",
  },
  producer: {
    eventPath,
    eventFile: fileStat(eventPath),
    monitorLaunchAgent: monitorAgent,
  },
  consumer: {
    statePath,
    stateFile: fileStat(statePath),
    stateBlocked: state.stateBlocked,
    reconcilePending: state.reconcilePending,
    lastHandledId: state.lastHandledId,
    lastReconciledAt: state.lastReconciledAt,
    lastActionAt: state.lastActionAt,
    lastError: state.lastError,
    lastRunError,
    pendingEventCount,
    eventScanError,
    actionDispositionCounts,
    lastRun: lastRun && {
      at: lastRun.at,
      noticeCount: lastRun.noticeCount,
      actionCount: lastRun.actionCount,
      draftedCount: lastRun.draftedCount,
      sentCount: lastRun.sentCount,
      ambiguousSendCount: lastRun.ambiguousSendCount,
      blockedSendCount: lastRun.blockedSendCount,
      failedCount: lastRun.failedCount,
      lastHandledId: lastRun.lastHandledId,
      lastError: lastRun.lastError,
    },
  },
  hostedBrain: {
    pendingCheckAvailable: unread.available,
    unread: unread.counts?.[persona]?.unread ?? null,
    unreadUrgent: unread.counts?.[persona]?.unreadUrgent ?? null,
    error: unread.error,
  },
  bridge: {
    launchAgent: bridgeAgent,
    appServer,
    daemonVersion: {
      ok: daemonVersion.ok,
      stdout: daemonVersion.stdout,
      error: daemonVersion.ok ? null : daemonVersion.error || "daemon_unavailable",
    },
  },
  outbound: {
    capabilityEnabled: Boolean(safetyPolicy.outbound?.enabled),
    modelDraftsRequireManualApproval: Boolean(
      safetyPolicy.outbound?.manualApprovalRequiredForModelDrafts,
    ),
    automaticPolicy: "exact-class-and-sender allowlist with deterministic templates",
    deliverySemantics: "at_most_once_no_automatic_retry",
    ledgerFile: fileStat(outboundLedgerPath),
    ledgerError: outboundLedgerError,
    ledgerStatusCounts: outboundLedgerCounts,
    sentCount: outboundLedgerCounts.sent || 0,
    ambiguousCount: (outboundLedgerCounts.send_ambiguous || 0)
      + (outboundLedgerCounts.sending || 0),
  },
  codex: {
    cliVersion: cliVersion.stdout || null,
    cliAvailable: cliVersion.ok,
  },
};

report.healthy = Boolean(
  report.plugin.manifest.exists
  && report.plugin.hooks.exists
  && report.plugin.lifecycleHooks.valid
  && report.plugin.hookRuntime.ok
  && report.producer.eventFile.exists
  && report.producer.monitorLaunchAgent.running
  && report.bridge.launchAgent.running
  && !report.consumer.stateBlocked
  && !report.consumer.reconcilePending
  && !report.consumer.lastRunError
  && (!report.consumer.lastRun
    || (report.consumer.lastRun.failedCount === 0
      && !report.consumer.lastRun.lastError))
  && report.consumer.pendingEventCount === 0
  && report.outbound.ambiguousCount === 0
  && !report.outbound.ledgerError
  && report.hostedBrain.pendingCheckAvailable
  && report.bridge.appServer.available,
);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.healthy) process.exitCode = 1;

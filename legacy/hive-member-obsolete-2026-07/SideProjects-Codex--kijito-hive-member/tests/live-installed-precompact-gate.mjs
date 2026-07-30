#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AppServerClient,
  isolatedAppServerEnvironment,
} from "../scripts/app-server-client.mjs";
import {
  assessQaPass,
  recordQaPass,
  resumeReceiptPath,
  resumeTicketPath,
  tokenPath,
} from "../scripts/qa-gate.mjs";

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const pointerId = Number(process.env.KIJITO_POINTER_ID);
const pointerDigest = process.env.KIJITO_POINTER_DIGEST;
const coldBootReportFiles = [
  process.env.KIJITO_COLD_BOOT_REPORT_1,
  process.env.KIJITO_COLD_BOOT_REPORT_2,
];
if (!Number.isSafeInteger(pointerId)
  || pointerId <= 0
  || !/^[a-f0-9]{64}$/.test(String(pointerDigest || ""))
  || coldBootReportFiles.some((file) => !path.isAbsolute(String(file || "")))) {
  throw new Error(
    "Set KIJITO_POINTER_ID, KIJITO_POINTER_DIGEST, and both absolute KIJITO_COLD_BOOT_REPORT paths to one snapshot verified by two clean cold boots.",
  );
}
const coldBootReports = coldBootReportFiles.map((file) => (
  JSON.parse(fs.readFileSync(file, "utf8"))
));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "kijito-precompact-live-"));
const workspace = path.join(root, "workspace");
fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });

const client = new AppServerClient({
  args: [
    "--disable", "apps",
    "-c", "mcp_servers={}",
    "app-server", "--stdio",
  ],
  cwd: workspace,
  env: isolatedAppServerEnvironment({
    ...process.env,
    CODEX_HOME: codexHome,
  }),
});

const notifications = [];
try {
  await client.start({ experimentalApi: true });
  const hooks = await client.call("hooks/list", { cwds: [workspace] }, 5000);
  const expectedHookEvents = [
    "postCompact",
    "preCompact",
    "sessionStart",
    "stop",
    "userPromptSubmit",
  ];
  const kijitoHooks = (hooks.data || [])
    .flatMap((entry) => entry.hooks || [])
    .filter((hook) => String(hook.sourcePath || "").includes("kijito-hive-member"));
  const actualHookEvents = kijitoHooks
    .map((hook) => hook.eventName)
    .sort();
  const allHooksReady = kijitoHooks.every(
    (hook) => hook.enabled === true && hook.trustStatus === "trusted",
  );
  if (kijitoHooks.length !== expectedHookEvents.length
    || !allHooksReady
    || actualHookEvents.some(
      (eventName, index) => eventName !== expectedHookEvents[index],
    )) {
    const error = Object.assign(
      new Error(
        "the complete installed Kijito lifecycle hook set must be enabled and trusted",
      ),
      {
        code: "installed_hook_trust_required",
        hooks: kijitoHooks,
      },
    );
    throw error;
  }
  const removeListener = client.onNotification((message) => {
    notifications.push(message);
  });
  const started = await client.call("thread/start", {
    cwd: workspace,
    model: "gpt-5.6-sol",
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: false,
    serviceName: "kijito-precompact-live-gate",
    config: {
      features: {
        apps: false,
        hooks: true,
      },
      mcp_servers: {},
    },
  }, 10000);
  const threadId = started.thread?.id;
  assert.match(threadId, /^[A-Za-z0-9-]+$/);

  let turnId = null;
  const terminal = client.waitForNotification(
    (message) => (
      message.method === "turn/completed"
      && message.params?.threadId === threadId
      && (!turnId
        || message.params?.turn?.id === turnId
        || message.params?.turnId === turnId)
    ),
    30000,
  );
  const turn = await client.call("turn/start", {
    threadId,
    input: [{
      type: "text",
      text: "Reply with exactly: OK",
    }],
    model: "gpt-5.6-sol",
    effort: "low",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxPolicy: {
      type: "readOnly",
      networkAccess: false,
    },
  }, 10000);
  turnId = turn.turn?.id || turn.turnId || null;
  const completed = await terminal;
  assert.equal(completed.method, "turn/completed");
  assert.equal(completed.params?.turn?.status, "completed");

  let compactError = null;
  let compactResponse = null;
  const unattestedPreCompactPromise = client.waitForNotification(
    (message) => (
      message.method === "hook/completed"
      && message.params?.threadId === threadId
      && message.params?.run?.eventName === "preCompact"
    ),
    30000,
  );
  const unattestedPostCompactPromise = client.waitForNotification(
    (message) => (
      message.method === "hook/completed"
      && message.params?.threadId === threadId
      && message.params?.run?.eventName === "postCompact"
    ),
    30000,
  );
  const unattestedCompactionPromise = client.waitForNotification(
    (message) => (
      message.method === "item/completed"
      && message.params?.threadId === threadId
      && message.params?.item?.type === "contextCompaction"
    ),
    30000,
  );
  try {
    compactResponse = await client.call(
      "thread/compact/start",
      { threadId },
      15000,
    );
  } catch (error) {
    compactError = {
      code: error.code || "compact_error",
      message: error.message,
    };
  }
  const [
    unattestedPreCompact,
    unattestedPostCompact,
    unattestedCompaction,
  ] = await Promise.all([
    unattestedPreCompactPromise,
    unattestedPostCompactPromise,
    unattestedCompactionPromise,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  removeListener();

  const compacted = notifications.some(
    (message) => message.method === "thread/compacted",
  );
  const compactionCompleted = notifications.some(
    (message) => (
      message.method === "item/completed"
      && message.params?.threadId === threadId
      && message.params?.item?.type === "contextCompaction"
    ),
  );
  const hookRuns = notifications
    .filter((message) => (
      message.method === "hook/completed"
      && message.params?.threadId === threadId
    ))
    .map((message) => message.params?.run)
    .filter(Boolean);
  assert.equal(
    unattestedPreCompact.params?.run?.status,
    "completed",
    "unattested PreCompact must preserve host liveness",
  );
  assert.equal(compactError, null, "native compaction must not be vetoed by Kijito");
  assert.notEqual(compactResponse, null);
  assert.equal(compacted, true, "compaction must complete without QA attestation");
  assert.equal(
    compactionCompleted,
    true,
    "a contextCompaction item must complete without QA attestation",
  );
  assert.equal(
    hookRuns.some((run) => run.eventName === "postCompact"),
    true,
    "PostCompact must surface explicit unattested recovery",
  );
  assert.equal(unattestedPostCompact.params?.run?.status, "completed");
  assert.equal(unattestedCompaction.params?.item?.type, "contextCompaction");

  const read = await client.call("thread/read", {
    threadId,
    includeTurns: true,
  }, 5000);
  const persistedCompactions = (read.thread?.turns || [])
    .flatMap((persistedTurn) => persistedTurn.items || [])
    .filter((item) => item.type === "contextCompaction");
  assert.equal(
    persistedCompactions.length,
    1,
    "the unattested attempt must persist one contextCompaction item",
  );
  const transcriptPath = read.thread?.path;
  assert.equal(typeof transcriptPath, "string");
  assert.equal(fs.lstatSync(transcriptPath).isFile(), true);
  const pluginDataRoot = path.join(codexHome, "plugins", "data");
  const dataCandidates = fs.readdirSync(pluginDataRoot, { withFileTypes: true })
    .filter((entry) => (
      entry.isDirectory()
      && !entry.isSymbolicLink()
      && entry.name.startsWith("kijito-hive-member")
    ))
    .map((entry) => path.join(pluginDataRoot, entry.name));
  assert.equal(
    dataCandidates.length,
    1,
    "exactly one installed Kijito plugin data directory is required",
  );
  const dataDir = dataCandidates[0];
  const passFile = recordQaPass({
    dataDir,
    sessionId: threadId,
    transcriptPath,
    pointerId,
    pointerDigest,
    coldBootReports,
  });
  assert.equal(passFile, tokenPath(dataDir, threadId));
  const recordedAssessment = assessQaPass({
    dataDir,
    sessionId: threadId,
    transcriptPath,
  });
  assert.equal(recordedAssessment.allowed, true);
  const recordedNonce = recordedAssessment.compactionNonce;
  assert.match(recordedNonce, /^[a-f0-9]{32}$/);

  const resumedNotifications = [];
  const removeResumedListener = client.onNotification((message) => {
    resumedNotifications.push(message);
  });
  const compactTerminalPromise = client.waitForNotification(
    (message) => (
      message.method === "turn/completed"
      && message.params?.threadId === threadId
      && message.params?.turn?.id !== turnId
    ),
    30000,
  );
  const allowedPreCompactPromise = client.waitForNotification(
    (message) => (
      message.method === "hook/completed"
      && message.params?.threadId === threadId
      && message.params?.run?.eventName === "preCompact"
    ),
    30000,
  );
  const allowedPostCompactPromise = client.waitForNotification(
    (message) => (
      message.method === "hook/completed"
      && message.params?.threadId === threadId
      && message.params?.run?.eventName === "postCompact"
    ),
    30000,
  );
  const completedCompactionPromise = client.waitForNotification(
    (message) => (
      message.method === "item/completed"
      && message.params?.threadId === threadId
      && message.params?.item?.type === "contextCompaction"
    ),
    30000,
  );
  const resumedCompactResponse = await client.call(
    "thread/compact/start",
    { threadId },
    15000,
  );
  const [
    compactTerminal,
    allowedPreCompact,
    allowedPostCompact,
    completedCompactionNotification,
  ] = await Promise.all([
    compactTerminalPromise,
    allowedPreCompactPromise,
    allowedPostCompactPromise,
    completedCompactionPromise,
  ]);
  removeResumedListener();

  const completedCompaction = resumedNotifications.some(
    (message) => (
      message.method === "item/completed"
      && message.params?.item?.type === "contextCompaction"
    ),
  );
  const completedHookEvents = resumedNotifications
    .filter((message) => message.method?.toLowerCase().includes("hook"))
    .map((message) => message.params?.run)
    .filter(Boolean);
  assert.equal(compactTerminal.method, "turn/completed");
  assert.equal(compactTerminal.params?.turn?.status, "completed");
  assert.equal(completedCompaction, true);
  assert.equal(fs.existsSync(passFile), false, "the QA pass must be consumed once");
  assert.equal(
    fs.existsSync(resumeTicketPath(dataDir, threadId)),
    false,
    "PostCompact must consume the nonce-bound re-entry ticket",
  );
  const receiptFile = resumeReceiptPath(dataDir, threadId);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  assert.equal(receipt.compactionNonce, recordedNonce);
  assert.equal(receipt.pointerId, pointerId);
  assert.equal(receipt.pointerDigest, pointerDigest);
  assert.equal(fs.statSync(receiptFile).mode & 0o077, 0);
  assert.equal(allowedPreCompact.params?.run?.status, "completed");
  assert.equal(allowedPostCompact.params?.run?.status, "completed");
  assert.equal(
    completedCompactionNotification.params?.item?.type,
    "contextCompaction",
  );

  const installedHooksFile = kijitoHooks[0].sourcePath;
  const installedRoot = path.dirname(path.dirname(installedHooksFile));
  const installedHook = path.join(installedRoot, "scripts", "hook.mjs");
  const installedEnv = {
    ...process.env,
    PLUGIN_ROOT: installedRoot,
    PLUGIN_DATA: dataDir,
  };
  const duplicatePostCompact = spawnSync(process.execPath, [
    installedHook,
    "--expect",
    "PostCompact",
  ], {
    input: JSON.stringify({
      hook_event_name: "PostCompact",
      trigger: "manual",
      session_id: threadId,
      transcript_path: transcriptPath,
      cwd: workspace,
      model: "gpt-5.6-sol",
    }),
    encoding: "utf8",
    env: installedEnv,
  });
  assert.equal(duplicatePostCompact.status, 0, duplicatePostCompact.stderr);
  assert.equal(
    duplicatePostCompact.stdout.trim(),
    "",
    "duplicate PostCompact must emit no second re-entry",
  );

  const compactSessionStart = spawnSync(process.execPath, [
    installedHook,
    "--expect",
    "SessionStart",
  ], {
    input: JSON.stringify({
      hook_event_name: "SessionStart",
      source: "compact",
      session_id: threadId,
      transcript_path: transcriptPath,
      cwd: workspace,
      model: "gpt-5.6-sol",
      permission_mode: "default",
    }),
    encoding: "utf8",
    env: installedEnv,
  });
  assert.equal(compactSessionStart.status, 0, compactSessionStart.stderr);
  assert.equal(
    compactSessionStart.stdout.trim(),
    "",
    "SessionStart(compact) must be a true no-op",
  );

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    recoveredWithoutPass: {
      compactResponse,
      compactError,
      compacted,
      compactionCompleted,
      persistedCompactionCount: persistedCompactions.length,
      preCompactRun: unattestedPreCompact.params?.run,
      postCompactRun: unattestedPostCompact.params?.run,
      hookRuns,
    },
    allowedWithPass: {
      pointerId,
      pointerDigest,
      transcriptPath,
      compactResponse: resumedCompactResponse,
      compactTerminal,
      completedCompaction,
      passConsumed: !fs.existsSync(passFile),
      recordedNonce,
      receipt,
      duplicatePostCompactNoop: duplicatePostCompact.stdout.trim() === "",
      compactSessionStartNoop: compactSessionStart.stdout.trim() === "",
      hookEvents: completedHookEvents,
    },
    installedHooks: kijitoHooks,
    tempRoot: root,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    code: error.code || "live_precompact_gate_failed",
    message: error.message,
    hooks: error.hooks,
    stderr: client.diagnosticStderr(),
    tempRoot: root,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close();
}

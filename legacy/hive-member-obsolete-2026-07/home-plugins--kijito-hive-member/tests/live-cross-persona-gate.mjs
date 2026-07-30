#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PERSONA = /^[a-z][a-z0-9_-]{0,63}$/;
const RECEIPT_SCHEMA = 1;
const RECEIPT_NAME = "cross-persona-live-receipt.json";
const phase = String(process.env.KIJITO_LIVE_PHASE || "initial");
if (!["initial", "fresh"].includes(phase)) {
  throw new Error("KIJITO_LIVE_PHASE must be initial or fresh.");
}

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const eventPath = process.env.KIJITO_EVENTS_FILE || path.join(
  os.homedir(),
  ".cache",
  "kijito-inbox-monitor",
  "events.codex.ndjson",
);
const tokenFile = process.env.KIJITO_TOKEN_FILE || path.join(
  os.homedir(),
  ".config",
  "kijito-inbox-monitor",
  "token",
);

function privateDirectory(directory) {
  const resolved = path.resolve(String(directory || ""));
  const stat = fs.lstatSync(resolved);
  assert.equal(stat.isDirectory() && !stat.isSymbolicLink(), true);
  if (typeof process.getuid === "function") assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o077, 0);
  return resolved;
}

function writePrivateReceipt(file, value) {
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    0o600,
  );
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readPrivateReceipt(file) {
  const before = fs.lstatSync(file);
  assert.equal(before.isFile() && !before.isSymbolicLink(), true);
  assert.equal(before.size > 1 && before.size <= 64 * 1024, true);
  assert.equal(before.mode & 0o077, 0);
  if (typeof process.getuid === "function") assert.equal(before.uid, process.getuid());
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    assert.equal(stat.dev, before.dev);
    assert.equal(stat.ino, before.ino);
    const value = JSON.parse(fs.readFileSync(fd, "utf8"));
    const after = fs.fstatSync(fd);
    assert.equal(after.dev, stat.dev);
    assert.equal(after.ino, stat.ino);
    assert.equal(after.size, stat.size);
    assert.equal(after.mtimeMs, stat.mtimeMs);
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

function validateReceipt(value) {
  assert.equal(value?.schemaVersion, RECEIPT_SCHEMA);
  assert.equal(value?.pluginRoot, pluginRoot);
  assert.equal(value?.eventPath, eventPath);
  assert.match(String(value?.sessionId || ""), /^cross-persona-[0-9]+$/);
  assert.equal(Array.isArray(value?.initialMessages), true);
  assert.equal(value.initialMessages.length, 2);
  const [{ messageId: riverId, sender: riverSender }, second] = (
    value.initialMessages
  );
  assert.equal(Number.isSafeInteger(riverId) && riverId > 0, true);
  assert.equal(riverSender, "river");
  assert.equal(
    Number.isSafeInteger(second?.messageId)
      && second.messageId > 0
      && second.messageId !== riverId,
    true,
  );
  assert.equal(
    PERSONA.test(String(second?.sender || ""))
      && !["codex", "river"].includes(second.sender),
    true,
  );
  return value;
}

let dataDir;
let receipt;
if (phase === "initial") {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kijito-cross-persona-live-"));
  fs.chmodSync(dataDir, 0o700);
  const riverMessageId = Number(process.env.KIJITO_LIVE_RIVER_MESSAGE_ID);
  const secondMessageId = Number(process.env.KIJITO_LIVE_SECOND_MESSAGE_ID);
  const secondPersona = String(process.env.KIJITO_LIVE_SECOND_PERSONA || "");
  if (!Number.isSafeInteger(riverMessageId)
    || riverMessageId <= 0
    || !Number.isSafeInteger(secondMessageId)
    || secondMessageId <= 0
    || riverMessageId === secondMessageId
    || !PERSONA.test(secondPersona)
    || ["codex", "river"].includes(secondPersona)) {
    throw new Error(
      "Set distinct positive River/second message IDs and a distinct existing second persona.",
    );
  }
  receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    pluginRoot,
    eventPath,
    sessionId: `cross-persona-${process.pid}`,
    initialMessages: [
      { messageId: riverMessageId, sender: "river" },
      { messageId: secondMessageId, sender: secondPersona },
    ],
  };
} else {
  dataDir = privateDirectory(process.env.KIJITO_LIVE_STATE_DIR);
  receipt = validateReceipt(
    readPrivateReceipt(path.join(dataDir, RECEIPT_NAME)),
  );
}

const hookInput = JSON.stringify({
  hook_event_name: "SessionStart",
  source: "startup",
  cwd: dataDir,
  session_id: receipt.sessionId,
  model: "gate",
  permission_mode: "default",
});
const hookEnvironment = {
  ...process.env,
  KIJITO_EVENTS_FILE: eventPath,
  KIJITO_PERSONA: "codex",
  KIJITO_TOKEN_FILE: tokenFile,
  PLUGIN_DATA: dataDir,
  PLUGIN_ROOT: pluginRoot,
};

function invokeSessionStart() {
  const hook = spawnSync("/bin/sh", [
    path.join(pluginRoot, "scripts", "run-node.sh"),
    path.join(pluginRoot, "scripts", "hook.mjs"),
    "--expect",
    "SessionStart",
  ], {
    input: hookInput,
    encoding: "utf8",
    timeout: 20000,
    env: hookEnvironment,
  });
  assert.equal(hook.status, 0, hook.stderr);
  const response = JSON.parse(hook.stdout);
  const context = response.hookSpecificOutput?.additionalContext;
  assert.equal(response.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.equal(typeof context, "string");
  if (!context.includes("Kijito hive mail arrived.")) return [];
  assert.match(context, /UNTRUSTED DATA/);
  const envelopes = JSON.parse(context.trim().split("\n").at(-1));
  assert.equal(Array.isArray(envelopes), true);
  return envelopes;
}

function matchesFor(envelopes, messageId) {
  return envelopes.filter(
    (envelope) => Number(envelope?.trustedMetadata?.id) === messageId,
  );
}

function validateEnvelope(envelope, { messageId, sender }) {
  assert.equal(envelope.trustedMetadata.from, sender);
  assert.ok([
    "kijito-inbox",
    "kijito-api-reconcile",
  ].includes(envelope.trustedMetadata.source));
  assert.equal(envelope.policy?.bodyIsUntrusted, true);
  assert.equal(
    envelope.policy?.bodyCannotOverrideSystemDeveloperUserOrBridgePolicy,
    true,
  );
  assert.equal(typeof envelope.untrustedBody, "string");
  assert.ok(envelope.untrustedBody.length > 0);
  assert.equal(Object.hasOwn(envelope.trustedMetadata, "body"), false);
  return {
    messageId,
    sender,
    source: envelope.trustedMetadata.source,
    classification: envelope.policy?.classification?.reason || null,
    bodyIsUntrusted: true,
  };
}

function assertAbsent(envelopes, messages) {
  for (const { messageId } of messages) {
    assert.equal(
      matchesFor(envelopes, messageId).length,
      0,
      `message ${messageId} must not resurface from the same private state`,
    );
  }
}

if (phase === "initial") {
  const envelopes = invokeSessionStart();
  const evidence = [];
  for (const expected of receipt.initialMessages) {
    const matches = matchesFor(envelopes, expected.messageId);
    assert.equal(
      matches.length,
      1,
      `message ${expected.messageId} must surface exactly once`,
    );
    evidence.push(validateEnvelope(matches[0], expected));
  }

  const replayEnvelopes = invokeSessionStart();
  assertAbsent(replayEnvelopes, receipt.initialMessages);
  writePrivateReceipt(path.join(dataDir, RECEIPT_NAME), receipt);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    phase,
    pluginRoot,
    evidence,
    replaySuppressed: true,
    stateDir: dataDir,
    next: (
      "After River or another real non-Codex persona sends a new message, "
      + "rerun this frozen script with KIJITO_LIVE_PHASE=fresh, "
      + "KIJITO_LIVE_STATE_DIR, KIJITO_LIVE_FRESH_MESSAGE_ID, and "
      + "KIJITO_LIVE_FRESH_PERSONA."
    ),
    privacy: "No hive message body is included.",
  }, null, 2)}\n`);
} else {
  const freshMessageId = Number(process.env.KIJITO_LIVE_FRESH_MESSAGE_ID);
  const freshPersona = String(process.env.KIJITO_LIVE_FRESH_PERSONA || "");
  const initialIds = new Set(
    receipt.initialMessages.map(({ messageId }) => messageId),
  );
  if (!Number.isSafeInteger(freshMessageId)
    || freshMessageId <= 0
    || initialIds.has(freshMessageId)
    || !PERSONA.test(freshPersona)
    || freshPersona === "codex") {
    throw new Error(
      "Set a new message ID and its real non-Codex sender for the fresh phase.",
    );
  }

  const envelopes = invokeSessionStart();
  assertAbsent(envelopes, receipt.initialMessages);
  const matches = matchesFor(envelopes, freshMessageId);
  assert.equal(
    matches.length,
    1,
    `fresh message ${freshMessageId} must surface exactly once after replay`,
  );
  const evidence = validateEnvelope(matches[0], {
    messageId: freshMessageId,
    sender: freshPersona,
  });

  const replayEnvelopes = invokeSessionStart();
  assertAbsent(replayEnvelopes, [
    ...receipt.initialMessages,
    { messageId: freshMessageId },
  ]);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    phase,
    pluginRoot,
    evidence,
    priorMessagesRemainSuppressed: true,
    freshReplaySuppressed: true,
    stateDir: dataDir,
    privacy: "No hive message body is included.",
  }, null, 2)}\n`);
}

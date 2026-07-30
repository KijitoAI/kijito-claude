#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fetchInbox } from "../scripts/kijito-api.mjs";

const sourceMessageId = Number(process.env.KIJITO_HEALTH_SOURCE_MESSAGE_ID);
if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
  throw new Error("Set KIJITO_HEALTH_SOURCE_MESSAGE_ID to the fresh River ping ID.");
}
const tokenFile = process.env.KIJITO_TOKEN_FILE || path.join(
  os.homedir(),
  ".config",
  "kijito-inbox-monitor",
  "token",
);
const dataDir = process.env.KIJITO_CODEX_DATA_DIR || path.join(
  os.homedir(),
  ".cache",
  "kijito-codex-bridge",
);
const observeMsRaw = Number(process.env.KIJITO_HEALTH_OBSERVE_MS || 10000);
const observeMs = Number.isFinite(observeMsRaw)
  && observeMsRaw >= 1000
  && observeMsRaw <= 30000
  ? observeMsRaw
  : 10000;
const appearMsRaw = Number(process.env.KIJITO_HEALTH_APPEAR_MS || 30000);
const appearMs = Number.isFinite(appearMsRaw)
  && appearMsRaw >= 1000
  && appearMsRaw <= 60000
  ? appearMsRaw
  : 30000;
const expectedContent = (
  `ACK monitor health ping for Kijito message ${sourceMessageId}. `
  + "Codex connector is online."
);

async function matchingAcks() {
  const inbox = await fetchInbox({
    persona: "river",
    tokenFile,
    timeoutMs: 10000,
  });
  assert.equal(inbox.available, true, inbox.error);
  return inbox.messages.filter((message) => (
    message.from === "codex"
    && message.content === expectedContent
  ));
}

async function waitForSingleAck() {
  const deadline = Date.now() + appearMs;
  let acks = [];
  do {
    acks = await matchingAcks();
    assert.ok(acks.length <= 1, "health ping must never create duplicate ACKs");
    if (acks.length === 1) return acks;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
  } while (Date.now() <= deadline);
  assert.fail(`one deterministic ACK did not appear within ${appearMs} ms`);
}

function readPrivateLedger(file) {
  const before = fs.lstatSync(file);
  assert.equal(before.isFile() && !before.isSymbolicLink(), true);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.dev, before.dev);
    assert.equal(stat.ino, before.ino);
    assert.equal(stat.size > 1 && stat.size <= 8 * 1024 * 1024, true);
    assert.equal(stat.mode & 0o077, 0);
    if (typeof process.getuid === "function") assert.equal(stat.uid, process.getuid());
    const content = fs.readFileSync(fd, "utf8");
    const after = fs.fstatSync(fd);
    assert.equal(after.dev, stat.dev);
    assert.equal(after.ino, stat.ino);
    assert.equal(after.size, stat.size);
    assert.equal(after.mtimeMs, stat.mtimeMs);
    return JSON.parse(content);
  } finally {
    fs.closeSync(fd);
  }
}

const first = await waitForSingleAck();
await new Promise((resolve) => setTimeout(resolve, observeMs));
const second = await matchingAcks();
assert.equal(second.length, 1, "replay observation must not create a duplicate ACK");
assert.equal(second[0].id, first[0].id);

const ledgerPath = path.join(dataDir, "outbound-ledger.json");
const ledger = readPrivateLedger(ledgerPath);
assert.equal(ledger.schemaVersion, 1);
const entries = Object.values(ledger.entries || {}).filter((entry) => (
  entry.sourceMessageId === sourceMessageId
  && entry.from === "codex"
  && entry.to === "river"
  && entry.messageClass === "monitor_health_ping"
));
assert.equal(entries.length, 1, "ledger must contain one reservation for the ping");
assert.equal(entries[0].status, "sent");
assert.equal(entries[0].sentMessageId, first[0].id);

process.stdout.write(`${JSON.stringify({
  status: "passed",
  sourceMessageId,
  ackMessageId: first[0].id,
  ledgerDigest: entries[0].digest,
  appearanceTimeoutMs: appearMs,
  observationMs: observeMs,
  ackCount: 1,
  privacy: "No hive message body beyond the deterministic public template is included.",
}, null, 2)}\n`);

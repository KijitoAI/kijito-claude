#!/usr/bin/env node

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeJsonAtomic } from "./io.mjs";
import { readToken, requestJson } from "./kijito-api.mjs";

const POINTER_SCHEMA = "kijito.codex.current-state/v1";
const REPORT_SCHEMA = "kijito.codex.pointer-snapshot/v1";
const POINTER_ID = /^[1-9][0-9]{0,15}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PERSONA_PATTERN = "[a-z][a-z0-9_-]{0,63}";
const NONCE_PATTERN = "[a-f0-9]{6}";
const BOOT_NONCE = /^[a-f0-9]{32}$/;
const LIFECYCLE_MARKER = /(?:^|\s)·\s+([a-z][a-z0-9_-]*)/g;
const STORED_FENCE_MARKER = /⟦\/?UNTRUSTED[^⟧\n]*⟧/u;
const MAX_POINTER_BYTES = 64 * 1024;
const MAX_ANCHORS = 64;
const MAX_LIST_ITEMS = 100;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(value, keys, code) {
  if (!isPlainObject(value)
    || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    fail(code, `expected exactly: ${keys.join(", ")}`);
  }
}

function requireString(value, name, { nullable = false, max = 2000 } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value.trim() !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail("pointer_manifest_invalid", `${name} is invalid`);
  }
}

function requireStringList(value, name) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    fail("pointer_manifest_invalid", `${name} is invalid`);
  }
  value.forEach((item, index) => requireString(item, `${name}[${index}]`));
}

export function memoryEnvelopeFromGetResult(result, memoryId) {
  const id = String(memoryId || "");
  if (!POINTER_ID.test(id) || typeof result !== "string") {
    fail("memory_response_invalid", "memory response is invalid");
  }
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openPattern = new RegExp(
    `⟦UNTRUSTED id=${escapedId} src=persona:(${PERSONA_PATTERN}) trust=memory-content n=(${NONCE_PATTERN})⟧\\n`,
    "gu",
  );
  const matches = [...result.matchAll(openPattern)];
  if (matches.length !== 1) {
    fail(
      matches.length ? "memory_fence_ambiguous" : "memory_fence_missing",
      "memory content fence is missing or ambiguous",
    );
  }
  const [open, persona, nonce] = matches[0];
  const openIndex = matches[0].index;
  const contentStart = openIndex + open.length;
  const close = `\n⟦/UNTRUSTED n=${nonce}⟧`;
  if (!result.endsWith(close)
    || result.indexOf(close, contentStart) !== result.length - close.length) {
    fail("memory_fence_incomplete", "memory content fence is incomplete");
  }
  const content = result.slice(contentStart, -close.length);
  if (STORED_FENCE_MARKER.test(content)) {
    fail("memory_fence_ambiguous", "memory content contains a nested fence");
  }
  const edgesIndex = result.indexOf("\nedges:");
  const headerEnd = edgesIndex >= 0 && edgesIndex < openIndex
    ? edgesIndex
    : openIndex;
  const header = result.slice(0, headerEnd).trimEnd();
  if (!header.startsWith(`Memory [${id}]\n`)) {
    fail("memory_header_invalid", "memory header does not match the requested id");
  }
  return { content, header, persona };
}

function oneHeaderValue(header, label) {
  const matches = [...header.matchAll(new RegExp(`^${label}: (.+)$`, "gmu"))];
  if (matches.length !== 1) {
    fail("memory_metadata_invalid", `${label} metadata is missing or ambiguous`);
  }
  return matches[0][1];
}

export function classifyMemoryLifecycle(result, memoryId) {
  const envelope = memoryEnvelopeFromGetResult(result, memoryId);
  const persona = oneHeaderValue(envelope.header, "Persona");
  const status = oneHeaderValue(envelope.header, "Status");
  const source = oneHeaderValue(envelope.header, "Source");
  const importanceText = oneHeaderValue(envelope.header, "Importance");
  const belief = oneHeaderValue(envelope.header, "belief");
  const markers = [...belief.matchAll(LIFECYCLE_MARKER)].map((match) => match[1]);
  if (markers.length > 1 || (markers.length === 1 && markers[0] !== "eroded")) {
    fail("memory_lifecycle_unclassified", "memory lifecycle marker is unsupported");
  }
  if (status !== "active") {
    fail("memory_lifecycle_unclassified", "memory Status is not a supported lifecycle signal");
  }
  if (persona !== envelope.persona) {
    fail("memory_metadata_invalid", "memory Persona and content fence disagree");
  }
  if (!["mcp", "correction"].includes(source)) {
    fail(
      "memory_lifecycle_unclassified",
      "memory Source has no measured lifecycle taxonomy",
    );
  }
  const importance = Number(importanceText);
  if (!Number.isFinite(importance) || importance < 0 || importance > 1) {
    fail("memory_metadata_invalid", "memory Importance is invalid");
  }
  if (!/^confidence=(?:0(?:\.\d+)?|1(?:\.0+)?) evidence=[0-9]+ basis=[a-z][a-z0-9_-]*(?: · eroded)?$/.test(belief)) {
    fail("memory_lifecycle_unclassified", "memory belief metadata is unclassified");
  }
  return {
    ...envelope,
    lifecycle: markers[0] === "eroded" ? "retired" : "current",
    observed: { status, source, importance, belief },
  };
}

export function parseCanonicalPointerManifest(
  content,
  expectedPointerId,
  expectedLockMessageId = null,
) {
  if (typeof content !== "string"
    || Buffer.byteLength(content, "utf8") > MAX_POINTER_BYTES) {
    fail("pointer_manifest_invalid", "pointer manifest is missing or too large");
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    fail("pointer_manifest_invalid", "pointer manifest is not JSON");
  }
  if (JSON.stringify(value) !== content) {
    fail(
      "pointer_manifest_not_canonical",
      "pointer manifest must equal compact JSON.stringify output",
    );
  }
  requireExactKeys(
    value,
    ["schema", "pointerId", "lock", "state", "task", "anchors"],
    "pointer_manifest_invalid",
  );
  if (value.schema !== POINTER_SCHEMA
    || !Number.isSafeInteger(value.pointerId)
    || value.pointerId <= 0
    || String(value.pointerId) !== String(expectedPointerId)
    || !["active", "complete"].includes(value.state)) {
    fail("pointer_manifest_invalid", "pointer identity, schema, or state is invalid");
  }
  requireExactKeys(
    value.lock,
    ["protocol", "messageId"],
    "pointer_manifest_invalid",
  );
  if (value.lock.protocol !== "kijito-message-claim/v1"
    || !Number.isSafeInteger(value.lock.messageId)
    || value.lock.messageId <= 0
    || (expectedLockMessageId !== null
      && value.lock.messageId !== expectedLockMessageId)) {
    fail("pointer_manifest_invalid", "pointer lock identity is invalid");
  }
  requireExactKeys(
    value.task,
    ["title", "nextAction", "done", "remaining", "doneWhen", "gate"],
    "pointer_manifest_invalid",
  );
  requireString(value.task.title, "task.title");
  requireString(value.task.nextAction, "task.nextAction", { nullable: true });
  requireStringList(value.task.done, "task.done");
  requireStringList(value.task.remaining, "task.remaining");
  requireStringList(value.task.doneWhen, "task.doneWhen");
  if (value.task.doneWhen.length === 0
    || new Set(value.task.done).size !== value.task.done.length
    || new Set(value.task.remaining).size !== value.task.remaining.length
    || new Set(value.task.doneWhen).size !== value.task.doneWhen.length
    || value.task.done.some((item) => value.task.remaining.includes(item))) {
    fail(
      "pointer_manifest_invalid",
      "task lists must be non-conflicting and DONE-WHEN must be explicit",
    );
  }
  requireExactKeys(
    value.task.gate,
    ["requiredConsecutiveGreens", "consecutiveGreens", "artifactDigest"],
    "pointer_manifest_invalid",
  );
  const gate = value.task.gate;
  if (gate.requiredConsecutiveGreens !== 2
    || !Number.isSafeInteger(gate.consecutiveGreens)
    || gate.consecutiveGreens < 0
    || gate.consecutiveGreens > 2
    || !(gate.artifactDigest === null || SHA256.test(gate.artifactDigest))) {
    fail("pointer_manifest_invalid", "task.gate is invalid");
  }
  if ((gate.consecutiveGreens === 0) !== (gate.artifactDigest === null)) {
    fail("pointer_manifest_invalid", "gate digest and count disagree");
  }
  if (value.state === "active"
    && (value.task.nextAction === null || value.task.remaining.length === 0)) {
    fail("pointer_manifest_invalid", "active state requires a next action and remaining work");
  }
  if (value.state === "complete"
    && (value.task.nextAction !== null || value.task.remaining.length !== 0)) {
    fail("pointer_manifest_invalid", "complete state cannot contain resumable work");
  }
  if (!Array.isArray(value.anchors) || value.anchors.length > MAX_ANCHORS) {
    fail("pointer_manifest_invalid", "anchors are invalid");
  }
  const ids = new Set();
  const currentIds = new Set();
  for (const anchor of value.anchors) {
    if (!isPlainObject(anchor)
      || !Number.isSafeInteger(anchor.id)
      || anchor.id <= 0
      || ids.has(anchor.id)
      || !["current", "retired"].includes(anchor.status)) {
      fail("pointer_manifest_invalid", "anchor identity or status is invalid");
    }
    ids.add(anchor.id);
    requireString(anchor.purpose, "anchor.purpose", { max: 500 });
    if (anchor.status === "current") {
      requireExactKeys(
        anchor,
        ["id", "status", "sha256", "purpose"],
        "pointer_manifest_invalid",
      );
      if (!SHA256.test(anchor.sha256)) {
        fail("pointer_manifest_invalid", "current anchor digest is invalid");
      }
      currentIds.add(anchor.id);
    } else {
      requireExactKeys(
        anchor,
        ["id", "status", "supersededBy", "purpose"],
        "pointer_manifest_invalid",
      );
      if (!Number.isSafeInteger(anchor.supersededBy) || anchor.supersededBy <= 0) {
        fail("pointer_manifest_invalid", "retired anchor successor is invalid");
      }
    }
  }
  for (const anchor of value.anchors) {
    if (anchor.status === "retired" && !currentIds.has(anchor.supersededBy)) {
      fail("pointer_manifest_invalid", "retired anchor successor must be current");
    }
  }
  if (value.state === "active" && currentIds.size === 0) {
    fail("pointer_manifest_invalid", "active state requires a current anchor");
  }
  return value;
}

export function pointerContentDigest(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function runKnownBadControl() {
  const id = 9;
  const nonce = "a1b2c3";
  const result = [
    `Memory [${id}]`,
    "Type: correction",
    "Scope: project",
    "Project: Codex",
    "Persona: codex",
    "Status: active",
    "Source: mcp",
    "Created: 2026-07-25 00:00:00",
    "Importance: 0.9",
    "belief: confidence=0.95 evidence=9 basis=observed · eroded",
    `⟦UNTRUSTED id=${id} src=persona:codex trust=memory-content n=${nonce}⟧`,
    "known-bad",
    `⟦/UNTRUSTED n=${nonce}⟧`,
  ].join("\n");
  const classified = classifyMemoryLifecycle(result, id);
  if (classified.lifecycle !== "retired") {
    fail("known_bad_control_failed", "eroded memory was not rejected as retired");
  }
  return "passed";
}

export async function verifyPointerSnapshot({
  pointerId,
  lockMessageId,
  expectedPointerDigest = null,
  expectedSnapshotDigest = null,
  tokenFile,
  requestImpl,
  now = Date.now(),
  bootNonce = crypto.randomBytes(16).toString("hex"),
} = {}) {
  const knownBadControl = runKnownBadControl();
  const id = String(pointerId || "");
  if (!POINTER_ID.test(id)
    || !Number.isSafeInteger(Number(lockMessageId))
    || Number(lockMessageId) <= 0
    || !(expectedPointerDigest === null || SHA256.test(expectedPointerDigest))
    || !(expectedSnapshotDigest === null || SHA256.test(expectedSnapshotDigest))
    || !BOOT_NONCE.test(String(bootNonce || ""))
    || !Number.isSafeInteger(now)
    || now < 0) {
    fail("invalid_pointer_expectation", "pointer expectation is invalid");
  }
  const token = readToken(tokenFile);
  if (!token) fail("token_file_missing", "Kijito API token is unavailable");
  const fetchMemory = async (memoryId) => requestJson({
    requestPath: `/api/memory/${memoryId}`,
    token,
    timeoutMs: 10000,
    responseLimitBytes: 1024 * 1024,
    requestImpl,
  });
  const pointerResult = await fetchMemory(id);
  const pointer = classifyMemoryLifecycle(pointerResult?.result, id);
  if (pointer.lifecycle !== "current") {
    fail("pointer_retired", "configured pointer is retired");
  }
  const pointerDigest = pointerContentDigest(pointer.content);
  if (expectedPointerDigest !== null && pointerDigest !== expectedPointerDigest) {
    fail("pointer_digest_mismatch", "configured pointer revision changed");
  }
  const lockId = Number(lockMessageId);
  const manifest = parseCanonicalPointerManifest(pointer.content, id, lockId);
  const anchors = [];
  for (const anchor of manifest.anchors) {
    if (anchor.status !== "current") continue;
    const data = await fetchMemory(anchor.id);
    const memory = classifyMemoryLifecycle(data?.result, anchor.id);
    if (memory.lifecycle !== "current") {
      fail("current_anchor_retired", `current anchor ${anchor.id} is eroded`);
    }
    const digest = pointerContentDigest(memory.content);
    if (digest !== anchor.sha256) {
      fail("anchor_digest_mismatch", `current anchor ${anchor.id} changed`);
    }
    anchors.push({ id: anchor.id, sha256: digest });
  }
  const snapshotDigest = pointerContentDigest(JSON.stringify({
    pointerId: Number(id),
    pointerDigest,
    lockMessageId: lockId,
    anchors,
  }));
  if (expectedSnapshotDigest !== null && snapshotDigest !== expectedSnapshotDigest) {
    fail("snapshot_digest_mismatch", "pointer or a current anchor changed");
  }
  return {
    schema: REPORT_SCHEMA,
    verdict: "green",
    knownBadControl,
    graphEdgesUsed: false,
    pointerId: Number(id),
    lockMessageId: lockId,
    pointerDigest,
    snapshotDigest,
    state: manifest.state,
    task: manifest.task,
    anchorDigests: anchors,
    bootNonce,
    verifiedAtMs: now,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pointer-id") options.pointerId = argv[++index];
    else if (arg === "--lock-message-id") options.lockMessageId = argv[++index];
    else if (arg === "--expected-pointer-digest") {
      options.expectedPointerDigest = argv[++index];
    } else if (arg === "--expected-snapshot-digest") {
      options.expectedSnapshotDigest = argv[++index];
    } else if (arg === "--token-file") options.tokenFile = argv[++index];
    else if (arg === "--report-file") options.reportFile = argv[++index];
    else fail("invalid_argument", `unknown argument: ${arg}`);
  }
  options.tokenFile ||= path.join(
    os.homedir(),
    ".config",
    "kijito-inbox-monitor",
    "token",
  );
  if (!options.reportFile || !path.isAbsolute(options.reportFile)) {
    fail("invalid_report_file", "an absolute report file is required");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await verifyPointerSnapshot(options);
  writeJsonAtomic(path.resolve(options.reportFile), report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`kijito_pointer_snapshot_failed:${error.code || "invalid_input"}\n`);
    process.exitCode = 1;
  }
}

export {
  POINTER_SCHEMA,
  REPORT_SCHEMA,
  main,
  parseArgs,
};

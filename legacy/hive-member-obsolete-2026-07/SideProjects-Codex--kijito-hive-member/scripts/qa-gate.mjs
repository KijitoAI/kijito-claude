#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensurePrivateDir, writeJsonAtomic } from "./io.mjs";

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_TRANSCRIPT_GROWTH = 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMPACTION_NONCE = /^[a-f0-9]{32}$/;
const BOOT_NONCE = /^[a-f0-9]{32}$/;
const SNAPSHOT_REPORT_SCHEMA = "kijito.codex.pointer-snapshot/v1";
const COMPACTION_ATTEMPT_MAX_AGE_MS = 5 * 60 * 1000;

function validIdentifier(value) {
  return IDENTIFIER.test(String(value || ""));
}

function tokenPath(dataDir, sessionId) {
  if (!validIdentifier(sessionId)) {
    throw Object.assign(new Error("session id is invalid"), {
      code: "invalid_session_id",
    });
  }
  return path.join(path.resolve(dataDir), "qa", `qa-pass.${sessionId}.json`);
}

function resumeTicketPath(dataDir, sessionId) {
  if (!validIdentifier(sessionId)) {
    throw Object.assign(new Error("session id is invalid"), {
      code: "invalid_session_id",
    });
  }
  return path.join(
    path.resolve(dataDir),
    "qa",
    `compaction-resume.${sessionId}.json`,
  );
}

function resumeReceiptPath(dataDir, sessionId) {
  if (!validIdentifier(sessionId)) {
    throw Object.assign(new Error("session id is invalid"), {
      code: "invalid_session_id",
    });
  }
  return path.join(
    path.resolve(dataDir),
    "qa",
    `compaction-resume-consumed.${sessionId}.json`,
  );
}

function compactionAttemptPath(dataDir, sessionId) {
  if (!validIdentifier(sessionId)) {
    throw Object.assign(new Error("session id is invalid"), {
      code: "invalid_session_id",
    });
  }
  return path.join(
    path.resolve(dataDir),
    "qa",
    `compaction-attempt.${sessionId}.json`,
  );
}

function pointerExpectationPath(dataDir) {
  return path.join(path.resolve(dataDir), "qa", "current-pointer.json");
}

function safeTranscriptIdentity(transcriptPath) {
  if (!transcriptPath) return null;
  let fd = null;
  try {
    const before = fs.lstatSync(transcriptPath);
    if (!before.isFile() || before.isSymbolicLink()) {
      return null;
    }
    fd = fs.openSync(
      transcriptPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()
      || stat.dev !== before.dev
      || stat.ino !== before.ino
      || stat.size !== before.size
      || stat.mtimeMs !== before.mtimeMs
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      return null;
    }
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function recordQaPass({
  dataDir,
  sessionId,
  transcriptPath,
  pointerId,
  pointerDigest,
  coldBootReports,
  now = Date.now(),
} = {}) {
  if (!Number.isSafeInteger(pointerId) || pointerId <= 0) {
    throw Object.assign(new Error("pointer id is invalid"), {
      code: "invalid_pointer_id",
    });
  }
  if (!SHA256.test(String(pointerDigest || ""))) {
    throw Object.assign(new Error("pointer content digest is invalid"), {
      code: "invalid_pointer_digest",
    });
  }
  const boots = validateColdBootReports({
    reports: coldBootReports,
    pointerId,
    pointerDigest,
    now,
  });
  const transcript = safeTranscriptIdentity(transcriptPath);
  if (!transcript) {
    throw Object.assign(new Error("transcript identity is unavailable or unsafe"), {
      code: "transcript_identity_unsafe",
    });
  }
  const file = tokenPath(dataDir, sessionId);
  ensurePrivateDir(path.dirname(file));
  const token = {
    schemaVersion: 5,
    sessionId,
    recordedAtMs: now,
    pointerId,
    lockMessageId: boots.lockMessageId,
    pointerDigest,
    snapshotDigest: boots.snapshotDigest,
    coldBootReportDigests: boots.reportDigests,
    compactionNonce: crypto.randomBytes(16).toString("hex"),
    transcript,
  };
  writeJsonAtomic(file, token);
  try {
    writeJsonAtomic(pointerExpectationPath(dataDir), {
      schemaVersion: 2,
      pointerId,
      lockMessageId: boots.lockMessageId,
      pointerDigest,
      snapshotDigest: boots.snapshotDigest,
      recordedAtMs: now,
    });
  } catch (error) {
    try {
      unlinkPrivateGateFile(file);
    } catch {}
    throw error;
  }
  return file;
}

function snapshotReportDigest(report) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(report), "utf8")
    .digest("hex");
}

export function validateColdBootReports({
  reports,
  pointerId,
  pointerDigest,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  if (!Array.isArray(reports) || reports.length !== 2) {
    throw Object.assign(new Error("exactly two cold-boot reports are required"), {
      code: "cold_boot_gate_incomplete",
    });
  }
  const nonces = new Set();
  let snapshotDigest = null;
  let lockMessageId = null;
  const reportDigests = [];
  for (const report of reports) {
    const task = report?.task;
    const taskValid = task
      && Object.keys(task).join(",") === "title,nextAction,done,remaining,doneWhen,gate"
      && typeof task.title === "string"
      && (task.nextAction === null || typeof task.nextAction === "string")
      && Array.isArray(task.done)
      && task.done.every((item) => typeof item === "string")
      && Array.isArray(task.remaining)
      && task.remaining.every((item) => typeof item === "string")
      && Array.isArray(task.doneWhen)
      && task.doneWhen.every((item) => typeof item === "string")
      && task.gate
      && Object.keys(task.gate).join(",")
        === "requiredConsecutiveGreens,consecutiveGreens,artifactDigest"
      && task.gate.requiredConsecutiveGreens === 2
      && Number.isSafeInteger(task.gate.consecutiveGreens)
      && task.gate.consecutiveGreens >= 0
      && task.gate.consecutiveGreens <= 2
      && (task.gate.artifactDigest === null
        || SHA256.test(String(task.gate.artifactDigest || "")))
      && ((task.gate.consecutiveGreens === 0)
        === (task.gate.artifactDigest === null));
    const anchorDigestsValid = Array.isArray(report?.anchorDigests)
      && report.anchorDigests.every((anchor) => (
        anchor
        && Number.isSafeInteger(anchor.id)
        && anchor.id > 0
        && SHA256.test(String(anchor.sha256 || ""))
        && Object.keys(anchor).length === 2
      ))
      && new Set(report.anchorDigests.map((anchor) => anchor.id)).size
        === report.anchorDigests.length;
    const calculatedSnapshotDigest = anchorDigestsValid
      ? crypto.createHash("sha256").update(JSON.stringify({
        pointerId,
        pointerDigest,
        lockMessageId: report.lockMessageId,
        anchors: report.anchorDigests,
      }), "utf8").digest("hex")
      : null;
    if (!report
      || report.schema !== SNAPSHOT_REPORT_SCHEMA
      || report.verdict !== "green"
      || report.knownBadControl !== "passed"
      || report.graphEdgesUsed !== false
      || report.pointerId !== pointerId
      || !Number.isSafeInteger(report.lockMessageId)
      || report.lockMessageId <= 0
      || report.pointerDigest !== pointerDigest
      || !SHA256.test(String(report.snapshotDigest || ""))
      || report.snapshotDigest !== calculatedSnapshotDigest
      || !["active", "complete"].includes(report.state)
      || !taskValid
      || (report.state === "active"
        && (task.nextAction === null || task.remaining.length === 0))
      || (report.state === "complete"
        && (task.nextAction !== null || task.remaining.length !== 0))
      || !anchorDigestsValid
      || !BOOT_NONCE.test(String(report.bootNonce || ""))
      || nonces.has(report.bootNonce)
      || !Number.isSafeInteger(report.verifiedAtMs)
      || report.verifiedAtMs > now
      || now - report.verifiedAtMs > maxAgeMs
      || Object.keys(report).join(",") !== [
        "schema",
        "verdict",
        "knownBadControl",
        "graphEdgesUsed",
        "pointerId",
        "lockMessageId",
        "pointerDigest",
        "snapshotDigest",
        "state",
        "task",
        "anchorDigests",
        "bootNonce",
        "verifiedAtMs",
      ].join(",")) {
      throw Object.assign(new Error("cold-boot report is invalid"), {
        code: "cold_boot_report_invalid",
      });
    }
    if (lockMessageId !== null && report.lockMessageId !== lockMessageId) {
      throw Object.assign(new Error("cold boots used different pointer locks"), {
        code: "cold_boot_lock_mismatch",
      });
    }
    if (snapshotDigest !== null && report.snapshotDigest !== snapshotDigest) {
      throw Object.assign(new Error("cold boots reviewed different snapshots"), {
        code: "cold_boot_snapshot_mismatch",
      });
    }
    snapshotDigest = report.snapshotDigest;
    lockMessageId = report.lockMessageId;
    nonces.add(report.bootNonce);
    reportDigests.push(snapshotReportDigest(report));
  }
  return { lockMessageId, snapshotDigest, reportDigests };
}

function safeReadToken(file) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()
      || stat.size < 2
      || stat.size > 16 * 1024
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())
      || (stat.mode & 0o077) !== 0) {
      return null;
    }
    const content = fs.readFileSync(fd, "utf8");
    const afterRead = fs.fstatSync(fd);
    if (afterRead.dev !== stat.dev
      || afterRead.ino !== stat.ino
      || afterRead.size !== stat.size
      || afterRead.mtimeMs !== stat.mtimeMs) {
      return null;
    }
    return JSON.parse(content);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

export function readPointerExpectation({ dataDir } = {}) {
  let value;
  try {
    value = safeReadToken(pointerExpectationPath(dataDir));
  } catch {
    return null;
  }
  if (!value
    || value.schemaVersion !== 2
    || !Number.isSafeInteger(value.pointerId)
    || value.pointerId <= 0
    || !Number.isSafeInteger(value.lockMessageId)
    || value.lockMessageId <= 0
    || !SHA256.test(String(value.pointerDigest || ""))
    || !SHA256.test(String(value.snapshotDigest || ""))
    || !Number.isSafeInteger(value.recordedAtMs)
    || Object.keys(value).join(",")
      !== "schemaVersion,pointerId,lockMessageId,pointerDigest,snapshotDigest,recordedAtMs") {
    return null;
  }
  return value;
}

function validQaTokenShape(token, sessionId) {
  return Boolean(
    token
    && Object.keys(token).join(",") === [
      "schemaVersion",
      "sessionId",
      "recordedAtMs",
      "pointerId",
      "lockMessageId",
      "pointerDigest",
      "snapshotDigest",
      "coldBootReportDigests",
      "compactionNonce",
      "transcript",
    ].join(",")
    && token.schemaVersion === 5
    && token.sessionId === sessionId
    && Number.isSafeInteger(token.pointerId)
    && token.pointerId > 0
    && Number.isSafeInteger(token.lockMessageId)
    && token.lockMessageId > 0
    && SHA256.test(String(token.pointerDigest || ""))
    && SHA256.test(String(token.snapshotDigest || ""))
    && Array.isArray(token.coldBootReportDigests)
    && token.coldBootReportDigests.length === 2
    && token.coldBootReportDigests.every((digest) => SHA256.test(String(digest || "")))
    && COMPACTION_NONCE.test(String(token.compactionNonce || ""))
    && Number.isSafeInteger(token.recordedAtMs)
    && token.transcript
    && Object.keys(token.transcript).join(",") === "dev,ino,size,mtimeMs"
    && Number.isSafeInteger(token.transcript.dev)
    && Number.isSafeInteger(token.transcript.ino)
    && Number.isSafeInteger(token.transcript.size)
    && Number.isFinite(token.transcript.mtimeMs)
  );
}

export function assessQaPass({
  dataDir,
  sessionId,
  transcriptPath,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  let file;
  try {
    file = tokenPath(dataDir, sessionId);
  } catch {
    return { allowed: false, reason: "invalid_session_id" };
  }
  let token;
  try {
    token = safeReadToken(file);
  } catch (error) {
    if (error.code === "ENOENT") return { allowed: false, reason: "qa_pass_missing" };
    return { allowed: false, reason: "qa_pass_unsafe" };
  }
  if (!token) return { allowed: false, reason: "qa_pass_invalid" };
  const currentTranscript = safeTranscriptIdentity(transcriptPath);
  if (!validQaTokenShape(token, sessionId)
    || token.recordedAtMs > now
    || now - token.recordedAtMs > maxAgeMs
    || !currentTranscript
    || token.transcript?.dev !== currentTranscript.dev
    || token.transcript?.ino !== currentTranscript.ino
    || currentTranscript.size < token.transcript.size
    || currentTranscript.size - token.transcript.size > MAX_TRANSCRIPT_GROWTH
    || currentTranscript.mtimeMs < token.transcript.mtimeMs) {
    return { allowed: false, reason: "qa_pass_stale_or_mismatched" };
  }
  return {
    allowed: true,
    reason: "qa_pass_valid",
    file,
    pointerId: token.pointerId,
    lockMessageId: token.lockMessageId,
    pointerDigest: token.pointerDigest,
    snapshotDigest: token.snapshotDigest,
    compactionNonce: token.compactionNonce,
  };
}

export function activateCompactionResume(assessment, { dataDir, sessionId } = {}) {
  if (!assessment?.allowed
    || !assessment.file
    || !COMPACTION_NONCE.test(String(assessment.compactionNonce || ""))) {
    return false;
  }
  let expectedToken;
  let ticket;
  try {
    expectedToken = tokenPath(dataDir, sessionId);
    ticket = resumeTicketPath(dataDir, sessionId);
  } catch {
    return false;
  }
  if (path.resolve(assessment.file) !== expectedToken) return false;
  try {
    // The hard-link plus unlink promotes the exact verified inode without an
    // overwrite window. If compaction later aborts, the orphaned ticket is
    // deliberately not reused: a retry must complete fresh memory QA.
    fs.linkSync(expectedToken, ticket);
    try {
      fs.unlinkSync(expectedToken);
    } catch {
      fs.unlinkSync(ticket);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function recordCompactionAttempt({
  dataDir,
  sessionId,
  trigger,
  attested,
  reason,
  compactionNonce = null,
  now = Date.now(),
} = {}) {
  if (!["manual", "auto"].includes(trigger)) {
    throw Object.assign(new Error("compaction trigger is invalid"), {
      code: "invalid_compaction_trigger",
    });
  }
  if (typeof attested !== "boolean"
    || typeof reason !== "string"
    || reason.length < 1
    || reason.length > 160
    || !Number.isSafeInteger(now)
    || (attested && !COMPACTION_NONCE.test(String(compactionNonce || "")))
    || (!attested && compactionNonce !== null)) {
    throw Object.assign(new Error("compaction attempt is invalid"), {
      code: "invalid_compaction_attempt",
    });
  }
  const file = compactionAttemptPath(dataDir, sessionId);
  writeJsonAtomic(file, {
    schemaVersion: 1,
    sessionId,
    recordedAtMs: now,
    trigger,
    attested,
    reason,
    compactionNonce,
  });
  return file;
}

function validCompactionAttempt(value, sessionId, now, maxAgeMs) {
  return Boolean(
    value
    && Object.keys(value).join(",")
      === "schemaVersion,sessionId,recordedAtMs,trigger,attested,reason,compactionNonce"
    && value.schemaVersion === 1
    && value.sessionId === sessionId
    && Number.isSafeInteger(value.recordedAtMs)
    && value.recordedAtMs <= now
    && now - value.recordedAtMs <= maxAgeMs
    && ["manual", "auto"].includes(value.trigger)
    && typeof value.attested === "boolean"
    && typeof value.reason === "string"
    && value.reason.length >= 1
    && value.reason.length <= 160
    && (value.attested
      ? COMPACTION_NONCE.test(String(value.compactionNonce || ""))
      : value.compactionNonce === null)
  );
}

export function claimCompactionAttempt({
  dataDir,
  sessionId,
  now = Date.now(),
  maxAgeMs = COMPACTION_ATTEMPT_MAX_AGE_MS,
} = {}) {
  let file;
  try {
    file = compactionAttemptPath(dataDir, sessionId);
  } catch {
    return null;
  }
  let value;
  try {
    value = safeReadToken(file);
  } catch {
    return null;
  }
  if (!validCompactionAttempt(value, sessionId, now, maxAgeMs)) return null;
  const nonce = crypto.randomBytes(16).toString("hex");
  const claim = `${file}.claim.${nonce}.${process.pid}`;
  try {
    fs.renameSync(file, claim);
  } catch {
    return null;
  }
  try {
    fs.unlinkSync(claim);
  } catch {}
  return value;
}

export function claimCompactionResume({
  dataDir,
  sessionId,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  let ticket;
  try {
    ticket = resumeTicketPath(dataDir, sessionId);
  } catch {
    return null;
  }
  let value;
  try {
    value = safeReadToken(ticket);
  } catch {
    return null;
  }
  if (!validQaTokenShape(value, sessionId)
    || value.recordedAtMs > now
    || now - value.recordedAtMs > maxAgeMs) {
    return null;
  }
  const claim = `${ticket}.claim.${value.compactionNonce}.${process.pid}`;
  try {
    // This atomic rename is the single-winner replay exclusion primitive.
    // The receipt below is durable audit evidence, not an authorization lock.
    fs.renameSync(ticket, claim);
  } catch {
    return null;
  }
  const receipt = resumeReceiptPath(dataDir, sessionId);
  try {
    writeJsonAtomic(receipt, {
      schemaVersion: 1,
      sessionId,
      compactionNonce: value.compactionNonce,
      pointerId: value.pointerId,
      lockMessageId: value.lockMessageId,
      pointerDigest: value.pointerDigest,
      snapshotDigest: value.snapshotDigest,
      claimedAtMs: now,
    });
  } catch {
    try {
      fs.renameSync(claim, ticket);
    } catch {}
    return null;
  }
  try {
    fs.unlinkSync(claim);
  } catch {}
  return {
    pointerId: value.pointerId,
    lockMessageId: value.lockMessageId,
    pointerDigest: value.pointerDigest,
    snapshotDigest: value.snapshotDigest,
    compactionNonce: value.compactionNonce,
  };
}

function unlinkPrivateGateFile(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile()
    || stat.isSymbolicLink()
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw Object.assign(new Error("compaction gate file is unsafe"), {
      code: "compaction_gate_file_unsafe",
    });
  }
  fs.unlinkSync(file);
  return true;
}

export function invalidateCompactionState({ dataDir, sessionId } = {}) {
  const files = [
    tokenPath(dataDir, sessionId),
    resumeTicketPath(dataDir, sessionId),
    compactionAttemptPath(dataDir, sessionId),
  ];
  return {
    invalidated: files.filter((file) => unlinkPrivateGateFile(file)).length,
  };
}

function parseCli(argv) {
  const [action, ...rest] = argv;
  const options = { action };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--session-id") options.sessionId = rest[++index];
    else if (arg === "--transcript") options.transcriptPath = rest[++index];
    else if (arg === "--data-dir") options.dataDir = rest[++index];
    else if (arg === "--pointer-id") options.pointerId = Number(rest[++index]);
    else if (arg === "--pointer-digest") options.pointerDigest = rest[++index];
    else if (arg === "--cold-boot-report") {
      options.coldBootReportFiles ||= [];
      options.coldBootReportFiles.push(rest[++index]);
    }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function compactionReadySignal({
  sessionId,
  passFile,
  compactionNonce,
} = {}) {
  if (!validIdentifier(sessionId)) {
    throw Object.assign(new Error("session id is invalid"), {
      code: "invalid_session_id",
    });
  }
  if (!COMPACTION_NONCE.test(String(compactionNonce || ""))) {
    throw Object.assign(new Error("compaction nonce is invalid"), {
      code: "invalid_compaction_nonce",
    });
  }
  return {
    schemaVersion: 1,
    type: "kijito.compaction.ready",
    sessionId,
    compactionNonce,
    passFile: path.resolve(passFile),
    requestedAction: "native_compact",
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.action === "invalidate") {
    const result = invalidateCompactionState(options);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      type: "kijito.compaction.invalidated",
      sessionId: options.sessionId,
      invalidated: result.invalidated,
    })}\n`);
    return;
  }
  if (options.action !== "record") {
    throw Object.assign(new Error("supported actions: record, invalidate"), {
      code: "invalid_action",
    });
  }
  options.coldBootReports = (options.coldBootReportFiles || []).map((file) => {
    try {
      return safeReadToken(path.resolve(file));
    } catch {
      return null;
    }
  });
  const file = recordQaPass(options);
  const assessment = assessQaPass({
    dataDir: options.dataDir,
    sessionId: options.sessionId,
    transcriptPath: options.transcriptPath,
  });
  if (!assessment.allowed) {
    throw Object.assign(new Error("recorded pass could not be verified"), {
      code: "recorded_pass_verification_failed",
    });
  }
  process.stdout.write(`Kijito pre-compaction QA pass recorded: ${file}\n`);
  process.stdout.write(`${JSON.stringify(compactionReadySignal({
    sessionId: options.sessionId,
    passFile: file,
    compactionNonce: assessment.compactionNonce,
  }))}\n`);
  process.stdout.write(
    "Request native Codex compaction now; do not perform intervening work or substitute /clear.\n",
  );
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`kijito_qa_gate_failed:${error.code || "invalid_input"}\n`);
    process.exitCode = 1;
  }
}

export {
  COMPACTION_ATTEMPT_MAX_AGE_MS,
  DEFAULT_MAX_AGE_MS,
  MAX_TRANSCRIPT_GROWTH,
  COMPACTION_NONCE,
  compactionAttemptPath,
  main,
  resumeReceiptPath,
  resumeTicketPath,
  pointerExpectationPath,
  safeTranscriptIdentity,
  snapshotReportDigest,
  tokenPath,
  validQaTokenShape,
};

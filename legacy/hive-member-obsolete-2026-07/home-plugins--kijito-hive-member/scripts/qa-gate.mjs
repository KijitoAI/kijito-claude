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
  coldBoots,
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
  if (coldBoots !== 2) {
    throw Object.assign(new Error("exactly two clean cold boots are required"), {
      code: "cold_boot_gate_incomplete",
    });
  }
  const transcript = safeTranscriptIdentity(transcriptPath);
  if (!transcript) {
    throw Object.assign(new Error("transcript identity is unavailable or unsafe"), {
      code: "transcript_identity_unsafe",
    });
  }
  const file = tokenPath(dataDir, sessionId);
  ensurePrivateDir(path.dirname(file));
  writeJsonAtomic(file, {
    schemaVersion: 3,
    sessionId,
    recordedAtMs: now,
    pointerId,
    pointerDigest,
    coldBoots,
    compactionNonce: crypto.randomBytes(16).toString("hex"),
    transcript,
  });
  return file;
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
  if (token.schemaVersion !== 3
    || token.sessionId !== sessionId
    || token.coldBoots !== 2
    || !Number.isSafeInteger(token.pointerId)
    || token.pointerId <= 0
    || !SHA256.test(String(token.pointerDigest || ""))
    || !COMPACTION_NONCE.test(String(token.compactionNonce || ""))
    || !Number.isSafeInteger(token.recordedAtMs)
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
    pointerDigest: token.pointerDigest,
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
  if (!value
    || value.schemaVersion !== 3
    || value.sessionId !== sessionId
    || value.coldBoots !== 2
    || !Number.isSafeInteger(value.pointerId)
    || value.pointerId <= 0
    || !SHA256.test(String(value.pointerDigest || ""))
    || !COMPACTION_NONCE.test(String(value.compactionNonce || ""))
    || !Number.isSafeInteger(value.recordedAtMs)
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
      pointerDigest: value.pointerDigest,
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
    pointerDigest: value.pointerDigest,
    compactionNonce: value.compactionNonce,
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
    else if (arg === "--cold-boots") options.coldBoots = Number(rest[++index]);
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
  if (options.action !== "record") {
    throw Object.assign(new Error("supported action: record"), {
      code: "invalid_action",
    });
  }
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
  DEFAULT_MAX_AGE_MS,
  MAX_TRANSCRIPT_GROWTH,
  COMPACTION_NONCE,
  main,
  resumeReceiptPath,
  resumeTicketPath,
  safeTranscriptIdentity,
  tokenPath,
};

#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensurePrivateDir } from "./io.mjs";
import {
  claimMessageLease,
  readToken,
  releaseMessageLease,
  requestJson,
} from "./kijito-api.mjs";
import {
  classifyMemoryLifecycle,
  parseCanonicalPointerManifest,
  pointerContentDigest,
  runKnownBadControl,
} from "./pointer-snapshot.mjs";

const POINTER_ID = /^[1-9][0-9]{0,15}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const DEFAULT_LEASE_SECONDS = 300;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function readOwnedRegularFile(file, maxBytes = MAX_MANIFEST_BYTES) {
  let fd = null;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile()
      || before.isSymbolicLink()
      || before.size < 2
      || before.size > maxBytes
      || (typeof process.getuid === "function" && before.uid !== process.getuid())) {
      fail("publish_input_file_unsafe", "publish input file is unsafe");
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    const content = fs.readFileSync(fd, "utf8");
    const after = fs.fstatSync(fd);
    if (!stat.isFile()
      || stat.dev !== before.dev
      || stat.ino !== before.ino
      || stat.size !== before.size
      || stat.mtimeMs !== before.mtimeMs
      || after.dev !== stat.dev
      || after.ino !== stat.ino
      || after.size !== stat.size
      || after.mtimeMs !== stat.mtimeMs) {
      fail("publish_input_file_unsafe", "publish input file changed during read");
    }
    return content;
  } catch (error) {
    if (error.code === "ELOOP") {
      fail("publish_input_file_unsafe", "publish input file is unsafe");
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function writePrivateJsonExclusive(file, value) {
  const target = path.resolve(file);
  ensurePrivateDir(path.dirname(target));
  let fd = null;
  let created = false;
  try {
    fd = fs.openSync(target, "wx", 0o600);
    created = true;
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    try {
      const dirFd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Some filesystems do not support syncing directory descriptors.
    }
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    if (created) {
      try {
        fs.unlinkSync(target);
      } catch {}
    }
    throw error;
  }
}

function publishError(error, releaseError) {
  if (!releaseError) return error;
  return Object.assign(new Error("pointer publish failed and mutex release also failed"), {
    code: "pointer_publish_and_release_failed",
    publishCode: error?.code || null,
    releaseCode: releaseError.code || "pointer_mutex_release_failed",
  });
}

async function verifyPointerLeaseOwnership({
  lockMessageId,
  leaseSeconds,
  tokenFile,
  requestImpl,
}) {
  const check = await claimMessageLease({
    messageId: lockMessageId,
    persona: "codex",
    leaseSeconds,
    tokenFile,
    requestImpl,
  });
  if (check.claimed) {
    fail(
      "pointer_mutex_ownership_lost",
      "pointer mutex was no longer held immediately before publication",
    );
  }
  if (check.advisory?.reason !== "self_claimed"
    || check.advisory?.claimed_by !== "codex"
    || check.advisory?.lease_expired !== false) {
    fail(
      "pointer_mutex_ownership_unverified",
      "pointer mutex ownership could not be verified immediately before publication",
    );
  }
}

export async function publishPointerManifest({
  pointerId,
  lockMessageId,
  expectedPointerDigest,
  content,
  rollbackFile,
  tokenFile,
  requestImpl,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  now = Date.now(),
} = {}) {
  const knownBadControl = runKnownBadControl();
  const id = String(pointerId || "");
  const lockId = Number(lockMessageId);
  if (!POINTER_ID.test(id)
    || !Number.isSafeInteger(lockId)
    || lockId <= 0
    || !SHA256.test(String(expectedPointerDigest || ""))
    || typeof content !== "string"
    || !path.isAbsolute(String(rollbackFile || ""))
    || !Number.isSafeInteger(now)
    || now < 0) {
    fail("pointer_publish_invalid", "pointer publish arguments are invalid");
  }
  parseCanonicalPointerManifest(content, id, lockId);
  const token = readToken(tokenFile);
  if (!token) fail("token_file_missing", "Kijito API token is unavailable");
  const claim = await claimMessageLease({
    messageId: lockId,
    persona: "codex",
    leaseSeconds,
    tokenFile,
    requestImpl,
  });
  if (!claim.claimed) {
    const expired = claim.advisory?.lease_expired === true;
    throw Object.assign(new Error(
      expired
        ? "pointer mutex is expired but still held; operator cleanup is required"
        : "pointer mutex is held by another persona",
    ), {
      code: expired
        ? "pointer_mutex_expired_requires_human"
        : "pointer_mutex_unavailable",
      claimedBy: claim.advisory?.claimed_by || "unknown",
    });
  }

  let result = null;
  let publishFailure = null;
  try {
    const beforeData = await requestJson({
      requestPath: `/api/memory/${id}`,
      token,
      timeoutMs: 10000,
      responseLimitBytes: 1024 * 1024,
      requestImpl,
    });
    const before = classifyMemoryLifecycle(beforeData?.result, id);
    if (before.lifecycle !== "current") {
      fail("pointer_publish_target_retired", "pointer publish target is retired");
    }
    const beforeDigest = pointerContentDigest(before.content);
    if (beforeDigest !== expectedPointerDigest) {
      fail("pointer_publish_conflict", "pointer changed before publication");
    }
    writePrivateJsonExclusive(rollbackFile, {
      schema: "kijito.codex.pointer-rollback/v1",
      pointerId: Number(id),
      lockMessageId: lockId,
      pointerDigest: beforeDigest,
      capturedAtMs: now,
      content: before.content,
    });

    await verifyPointerLeaseOwnership({
      lockMessageId: lockId,
      leaseSeconds,
      tokenFile,
      requestImpl,
    });

    let update = null;
    let patchFailure = null;
    try {
      update = await requestJson({
        requestPath: `/api/memory/${id}`,
        token,
        method: "PATCH",
        body: {
          content,
          persona: "codex",
          scope: "project",
          project: "Codex",
        },
        timeoutMs: 10000,
        responseLimitBytes: 1024 * 1024,
        requestImpl,
      });
    } catch (error) {
      patchFailure = error;
    }

    let afterData;
    try {
      afterData = await requestJson({
        requestPath: `/api/memory/${id}`,
        token,
        timeoutMs: 10000,
        responseLimitBytes: 1024 * 1024,
        requestImpl,
      });
    } catch (error) {
      throw Object.assign(new Error(
        "pointer state could not be reconciled after the update attempt",
      ), {
        code: "pointer_publish_reconciliation_unavailable",
        patchCode: patchFailure?.code || (
          update?.result === `Updated [${id}]`
            ? null
            : "pointer_publish_response_invalid"
        ),
        reconciliationCode: error.code || "pointer_reconciliation_failed",
      });
    }

    const after = classifyMemoryLifecycle(afterData?.result, id);
    const publishedDigest = pointerContentDigest(content);
    const afterDigest = pointerContentDigest(after.content);
    const responseValid = update?.result === `Updated [${id}]`;
    if (after.lifecycle !== "current") {
      fail(
        "pointer_publish_reconciliation_failed",
        "pointer lifecycle changed during publication",
      );
    }
    if (after.content !== content || afterDigest !== publishedDigest) {
      if (after.content === before.content && afterDigest === beforeDigest) {
        throw Object.assign(new Error(
          "pointer update was not committed; automatic retry is forbidden",
        ), {
          code: patchFailure?.code === "kijito_http_403"
            ? "pointer_publish_not_found_or_forbidden"
            : "pointer_publish_not_committed",
          patchCode: patchFailure?.code || (
            responseValid ? null : "pointer_publish_response_invalid"
          ),
        });
      }
      throw Object.assign(new Error(
        "pointer was concurrently clobbered after the update attempt; automatic retry is forbidden",
      ), {
        code: "pointer_publish_concurrent_clobber",
        patchCode: patchFailure?.code || (
          responseValid ? null : "pointer_publish_response_invalid"
        ),
        observedPointerDigest: afterDigest,
      });
    }
    result = {
      schema: "kijito.codex.pointer-publish-receipt/v1",
      status: patchFailure || !responseValid
        ? "published_reconciled"
        : "published",
      knownBadControl,
      pointerId: Number(id),
      lockMessageId: lockId,
      previousPointerDigest: expectedPointerDigest,
      pointerDigest: publishedDigest,
      patchOutcome: patchFailure?.code || (
        responseValid ? "acknowledged" : "response_invalid"
      ),
      rollbackFile: path.resolve(rollbackFile),
    };
  } catch (error) {
    publishFailure = error;
  }

  let releaseFailure = null;
  try {
    const release = await releaseMessageLease({
      messageId: lockId,
      persona: "codex",
      tokenFile,
      requestImpl,
    });
    if (!release.released) {
      fail("pointer_mutex_release_failed", "pointer mutex was not released");
    }
  } catch (error) {
    releaseFailure = error;
  }
  if (publishFailure || releaseFailure) {
    throw publishError(publishFailure, releaseFailure);
  }
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pointer-id") options.pointerId = argv[++index];
    else if (arg === "--lock-message-id") options.lockMessageId = argv[++index];
    else if (arg === "--expected-pointer-digest") {
      options.expectedPointerDigest = argv[++index];
    } else if (arg === "--content-file") options.contentFile = argv[++index];
    else if (arg === "--rollback-file") options.rollbackFile = argv[++index];
    else if (arg === "--token-file") options.tokenFile = argv[++index];
    else fail("invalid_argument", `unknown argument: ${arg}`);
  }
  options.tokenFile ||= path.join(
    os.homedir(),
    ".config",
    "kijito-inbox-monitor",
    "token",
  );
  if (!path.isAbsolute(String(options.contentFile || ""))
    || !path.isAbsolute(String(options.rollbackFile || ""))) {
    fail("pointer_publish_invalid", "content and rollback paths must be absolute");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  options.content = readOwnedRegularFile(options.contentFile);
  const receipt = await publishPointerManifest(options);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`kijito_pointer_publish_failed:${error.code || "invalid_input"}\n`);
    process.exitCode = 1;
  }
}

export {
  main,
  parseArgs,
  readOwnedRegularFile,
  writePrivateJsonExclusive,
};

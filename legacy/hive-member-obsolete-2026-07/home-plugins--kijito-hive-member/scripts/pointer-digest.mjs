#!/usr/bin/env node

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readToken, requestJson } from "./kijito-api.mjs";

const POINTER_ID = /^[1-9][0-9]{0,15}$/;
const NONCE = /^[a-f0-9]{6}$/;
const STORED_FENCE_MARKER = /⟦\/?UNTRUSTED[^⟧\n]*⟧/u;

export function pointerContentFromGetResult(result, pointerId) {
  const id = String(pointerId || "");
  if (!POINTER_ID.test(id) || typeof result !== "string") {
    throw Object.assign(new Error("pointer response is invalid"), {
      code: "pointer_response_invalid",
    });
  }
  const prefix = `⟦UNTRUSTED id=${id} src=persona:codex trust=memory-content n=`;
  const openIndex = result.indexOf(prefix);
  if (openIndex < 0) {
    throw Object.assign(new Error("pointer content fence is missing"), {
      code: "pointer_fence_missing",
    });
  }
  if (result.indexOf(prefix, openIndex + prefix.length) >= 0) {
    throw Object.assign(new Error("pointer content fence is ambiguous"), {
      code: "pointer_fence_ambiguous",
    });
  }
  const nonceStart = openIndex + prefix.length;
  const openEnd = result.indexOf("⟧\n", nonceStart);
  const nonce = openEnd < 0 ? "" : result.slice(nonceStart, openEnd);
  if (!NONCE.test(nonce)) {
    throw Object.assign(new Error("pointer content fence is invalid"), {
      code: "pointer_fence_invalid",
    });
  }
  const close = `\n⟦/UNTRUSTED n=${nonce}⟧`;
  if (!result.endsWith(close)) {
    throw Object.assign(new Error("pointer content fence is incomplete"), {
      code: "pointer_fence_incomplete",
    });
  }
  const closeIndex = result.indexOf(close, openEnd + 2);
  if (closeIndex < 0
    || result.indexOf(close, closeIndex + close.length) >= 0) {
    throw Object.assign(new Error("pointer content close fence is ambiguous"), {
      code: "pointer_fence_ambiguous",
    });
  }
  const content = result.slice(openEnd + 2, -close.length);
  if (STORED_FENCE_MARKER.test(content)) {
    throw Object.assign(new Error("pointer content contains an impossible nested fence"), {
      code: "pointer_fence_ambiguous",
    });
  }
  return content;
}

export function pointerContentDigest(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export async function hostedPointerDigest({
  pointerId,
  tokenFile,
  requestImpl,
} = {}) {
  const id = String(pointerId || "");
  if (!POINTER_ID.test(id)) {
    throw Object.assign(new Error("pointer id is invalid"), {
      code: "invalid_pointer_id",
    });
  }
  const token = readToken(tokenFile);
  if (!token) {
    throw Object.assign(new Error("Kijito API token is unavailable"), {
      code: "token_file_missing",
    });
  }
  const data = await requestJson({
    requestPath: `/api/memory/${id}`,
    token,
    timeoutMs: 10000,
    responseLimitBytes: 1024 * 1024,
    requestImpl,
  });
  const content = pointerContentFromGetResult(data?.result, id);
  return pointerContentDigest(content);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pointer-id") options.pointerId = argv[++index];
    else if (arg === "--token-file") options.tokenFile = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.tokenFile ||= path.join(
    os.homedir(),
    ".config",
    "kijito-inbox-monitor",
    "token",
  );
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const digest = await hostedPointerDigest(parseArgs(argv));
  process.stdout.write(`${digest}\n`);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`kijito_pointer_digest_failed:${error.code || "invalid_input"}\n`);
    process.exitCode = 1;
  }
}

export { main, parseArgs };

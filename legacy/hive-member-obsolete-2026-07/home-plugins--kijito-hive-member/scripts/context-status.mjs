#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeJsonAtomic } from "./io.mjs";

const MAX_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_CONTEXT_WINDOW = 10_000_000;
const MAX_DISCOVERY_ENTRIES = 20_000;
const MAX_DISCOVERY_DEPTH = 6;

function validThreadId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(String(value || ""));
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function normalizeTokenUsage(tokenUsage, source, threadId) {
  const last = tokenUsage?.last;
  const window = tokenUsage?.modelContextWindow;
  if (!integer(window) || window < 1 || window > MAX_CONTEXT_WINDOW
    || !integer(last?.inputTokens)
    || !integer(last?.cachedInputTokens)
    || !integer(last?.outputTokens)
    || !integer(last?.reasoningOutputTokens)
    || !integer(last?.totalTokens)
    || last.totalTokens !== last.inputTokens + last.outputTokens
    || last.inputTokens > window
    || last.cachedInputTokens > last.inputTokens
    || last.reasoningOutputTokens > last.outputTokens) {
    return null;
  }
  const usedTokens = last.inputTokens;
  return {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    source,
    threadId,
    usedTokens,
    contextWindow: window,
    remainingTokens: window - usedTokens,
    usedPercent: Number(((usedTokens / window) * 100).toFixed(1)),
  };
}

function safeTranscriptPath(transcriptPath, threadId, codexHome) {
  if (!transcriptPath || !threadId) return null;
  const sessionsRoot = path.join(codexHome, "sessions");
  const resolved = path.resolve(transcriptPath);
  const resolvedRoot = path.resolve(sessionsRoot);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)
    || !path.basename(resolved).endsWith(`-${threadId}.jsonl`)) {
    return null;
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const realFile = fs.realpathSync(resolved);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    return null;
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return null;
  return { resolved, stat };
}

export function findExactThreadTranscript({
  threadId,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
} = {}) {
  if (!validThreadId(threadId)) return null;
  const root = path.join(path.resolve(codexHome), "sessions");
  const suffix = `-${threadId}.jsonl`;
  const matches = [];
  let visited = 0;
  function walk(dir, depth) {
    if (depth > MAX_DISCOVERY_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_DISCOVERY_ENTRIES) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(suffix)) matches.push(full);
      if (matches.length > 1 || visited > MAX_DISCOVERY_ENTRIES) return;
    }
  }
  walk(root, 0);
  return visited <= MAX_DISCOVERY_ENTRIES && matches.length === 1
    ? matches[0]
    : null;
}

export function readRolloutContext({
  transcriptPath,
  threadId,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
} = {}) {
  if (!validThreadId(threadId)) return null;
  let safe;
  try {
    safe = safeTranscriptPath(transcriptPath, threadId, codexHome);
  } catch {
    return null;
  }
  if (!safe) return null;
  const length = Math.min(safe.stat.size, MAX_TAIL_BYTES);
  const start = safe.stat.size - length;
  const fd = fs.openSync(
    safe.resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()
      || opened.dev !== safe.stat.dev
      || opened.ino !== safe.stat.ino
      || opened.size !== safe.stat.size
      || (typeof process.getuid === "function" && opened.uid !== process.getuid())) {
      return null;
    }
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const bytesRead = fs.readSync(fd, buffer, offset, length - offset, start + offset);
      if (bytesRead === 0) return null;
      offset += bytesRead;
    }
    const afterRead = fs.fstatSync(fd);
    if (afterRead.dev !== opened.dev
      || afterRead.ino !== opened.ino
      || afterRead.size !== opened.size
      || afterRead.mtimeMs !== opened.mtimeMs) {
      return null;
    }
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index].includes("token_count")) continue;
      let event;
      try {
        event = JSON.parse(lines[index]);
      } catch {
        return null;
      }
      if (event?.type !== "event_msg") {
        continue;
      }
      if (event.payload?.type !== "token_count" || !event.payload?.info) return null;
      const info = event.payload.info;
      return normalizeTokenUsage({
        last: {
          inputTokens: info.last_token_usage?.input_tokens,
          cachedInputTokens: info.last_token_usage?.cached_input_tokens,
          outputTokens: info.last_token_usage?.output_tokens,
          reasoningOutputTokens: info.last_token_usage?.reasoning_output_tokens,
          totalTokens: info.last_token_usage?.total_tokens,
        },
        modelContextWindow: info.model_context_window,
      }, "validated_exact_transcript_fallback", threadId);
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

export async function contextStatus({
  threadId,
  transcriptPath,
  dataDir,
  codexHome,
  allowDiscovery = true,
} = {}) {
  if (!validThreadId(threadId)) return null;
  const selectedPath = transcriptPath || (allowDiscovery
    ? findExactThreadTranscript({ threadId, codexHome })
    : null);
  const status = readRolloutContext({
    transcriptPath: selectedPath,
    threadId,
    codexHome,
  });
  if (status && dataDir) {
    writeJsonAtomic(path.join(dataDir, "context-status.current.json"), status);
  }
  return status;
}

export function contextReminder(status) {
  if (!status) {
    return "Kijito context telemetry: unknown. Use native /status; do not estimate context usage.";
  }
  const boundary = status.usedPercent >= 60
    ? "At or above the 60% planning boundary: prepare a QA-verified handoff at the next clean boundary."
    : "Below the 60% planning boundary: continue; do not recycle based on felt context.";
  return `Kijito context telemetry: ${status.usedPercent}% used `
    + `(${status.usedTokens}/${status.contextWindow} tokens; source=${status.source}). ${boundary}`;
}

async function main() {
  const threadId = process.env.CODEX_THREAD_ID || "";
  const status = await contextStatus({
    threadId,
    transcriptPath: process.env.CODEX_TRANSCRIPT_PATH || "",
    cwd: process.cwd(),
    dataDir: process.env.PLUGIN_DATA,
  });
  process.stdout.write(`${contextReminder(status)}\n`);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

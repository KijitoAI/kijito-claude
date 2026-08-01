import {
  MAX_JSON_BYTES,
  MAX_RECORDS,
  countOccurrences,
  fail,
  isObject,
  requireNonce, requireObject,
  requireSafeInteger,
  requireString,
  sha256,
  stableJson,
} from "./lib.mjs";

function jsonlRecords(text) {
  if (typeof text !== "string") fail("ROLLOUT_TYPE", "rollout must be UTF-8 text");
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) fail("ROLLOUT_TOO_LARGE", `rollout exceeds ${MAX_JSON_BYTES} bytes`);
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_RECORDS) fail("ROLLOUT_RECORD_COUNT", "rollout record count is invalid");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail("ROLLOUT_JSON", `invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

function userText(record) {
  if (record?.type !== "response_item") return null;
  const payload = record.payload;
  if (payload?.type !== "message" || payload.role !== "user" || !Array.isArray(payload.content)) return null;
  const text = payload.content
    .filter((item) => item?.type === "input_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  return { text, metadata: payload.internal_chat_message_metadata_passthrough ?? {} };
}

export function parseRollout(text) {
  const records = jsonlRecords(text);
  const first = records[0];
  if (first?.type !== "session_meta" || typeof first?.payload?.id !== "string" || !first.payload.id) {
    fail("SESSION_META_MISSING", "first rollout record must contain session_meta.payload.id");
  }
  return { sessionId: first.payload.id, records };
}

export function requireNonceInOneUserTurn(records, nonce, {
  expectedTurnId,
  expectedTaskId,
  expectedRunId,
  label = "run",
} = {}) {
  requireNonce(nonce, "NONCE_INVALID", `${label} nonce`);
  const matches = [];
  for (const [index, record] of records.entries()) {
    const user = userText(record);
    if (!user) continue;
    const count = countOccurrences(user.text, nonce);
    if (count) matches.push({ index, count, ...user });
  }
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (total !== 1) fail("NONCE_USER_SPAN", `${label} nonce must occur exactly once in exactly one user turn`);
  const [{ metadata, index }] = matches;
  if (expectedTurnId !== undefined && metadata.turn_id !== expectedTurnId) fail("TURN_ID_MISMATCH", `${label} nonce user turn has wrong turn id`);
  if (expectedTaskId !== undefined && metadata.scheduled_task_id !== expectedTaskId) fail("TASK_ID_MISMATCH", `${label} nonce user turn has wrong task id`);
  if (expectedRunId !== undefined && metadata.scheduled_run_id !== expectedRunId) fail("RUN_ID_MISMATCH", `${label} nonce user turn has wrong run id`);
  return { index, metadata };
}

export function selectMarkerRollout(candidates, markerNonce) {
  requireNonce(markerNonce, "MARKER_NONCE_INVALID", "marker nonce");
  const matches = [];
  for (const candidate of candidates) {
    try {
      const parsed = parseRollout(candidate.text);
      requireNonceInOneUserTurn(parsed.records, markerNonce, { label: "marker" });
      matches.push({ path: candidate.path, sessionId: parsed.sessionId, records: parsed.records });
    } catch (error) {
      if (!["NONCE_USER_SPAN"].includes(error?.code)) throw error;
    }
  }
  if (matches.length === 0) fail("MARKER_ZERO_MATCH", "no changed rollout contains the marker in a user turn");
  if (matches.length > 1) fail("MARKER_MULTIPLE_MATCH", "multiple changed rollouts contain the marker in a user turn");
  return matches[0];
}

function findTurnContext(records, turnId) {
  const matches = records.filter((record) => record?.type === "turn_context" && record?.payload?.turn_id === turnId);
  if (matches.length !== 1) fail("TURN_CONTEXT_COUNT", "expected exactly one matching turn_context record");
  return matches[0].payload;
}

function hasSteer(records) {
  const structural = (value) => {
    if (!isObject(value)) return false;
    if (value.method === "turn/steer" || value.type === "turn_steered" || value.type === "turn/steer") return true;
    return Object.values(value).some((child) => Array.isArray(child)
      ? child.some((item) => structural(item))
      : structural(child));
  };
  return records.some((record) => structural(record));
}

export function verifyScheduledRun({ rolloutText, runRecord, expected }) {
  const parsed = parseRollout(rolloutText); runRecord = requireObject(runRecord, "RUN_RECORD_INVALID", "runRecord");
  if (parsed.sessionId !== expected.sessionId) fail("WRONG_CHAT", "rollout session id does not equal pinned T");
  for (const key of ["taskId", "runId", "turnId"]) requireString(runRecord[key], "RUN_RECORD_INVALID", `runRecord.${key}`);
  if (runRecord.taskId !== expected.taskId || runRecord.runId !== expected.runId || runRecord.turnId !== expected.turnId) {
    fail("RUN_RECORD_MISMATCH", "Scheduled control record does not equal frozen specimen identity");
  }
  requireNonceInOneUserTurn(parsed.records, expected.runNonce, {
    expectedTurnId: expected.turnId,
    expectedTaskId: expected.taskId,
    expectedRunId: expected.runId,
    label: "scheduled run",
  });
  const context = findTurnContext(parsed.records, expected.turnId);
  const actualEnvironment = {
    cwd: context.cwd,
    project: context.project,
    worktree: context.worktree,
    workspace_roots: context.workspace_roots,
    model: context.model,
    reasoning: context.reasoning,
    approval_policy: context.approval_policy,
    sandbox_policy: context.sandbox_policy,
    permission_profile: context.permission_profile,
    network: context.network,
  };
  if (stableJson(actualEnvironment) !== stableJson(expected.environment)) {
    fail("ENVIRONMENT_DRIFT", "rollout environment differs from frozen specimen", { actualEnvironment, expected: expected.environment });
  }
  if (hasSteer(parsed.records)) fail("STEER_DETECTED", "rollout contains structural steering evidence");
  return { sessionId: parsed.sessionId, turnContext: context, records: parsed.records };
}

function parseFenceHeader(line) {
  const match = /^⟦UNTRUSTED id=(\d+) src=persona:([a-z0-9_-]+) trust=memory-content n=([0-9a-f]+)⟧$/.exec(line);
  if (!match) return null;
  return { id: Number(match[1]), persona: match[2], nonce: match[3] };
}

export function parseKijitoMainBody(raw, expectedId, expectedPersona = "codex") {
  requireSafeInteger(expectedId, "POINTER_ID_INVALID", "pointer id");
  requireString(raw, "KIJITO_GET_INVALID", "kijito_get response", { min: 1, max: MAX_JSON_BYTES });
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) fail("KIJITO_GET_INVALID", "kijito_get response exceeds byte limit");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = parseFenceHeader(lines[index]);
    if (!header || header.id !== expectedId || header.persona !== expectedPersona) continue;
    const closing = `⟦/UNTRUSTED n=${header.nonce}⟧`;
    const closeIndex = lines.indexOf(closing, index + 1);
    if (closeIndex === -1) fail("POINTER_FENCE_UNCLOSED", "main pointer fence is not closed");
    candidates.push({ header, openIndex: index, closeIndex, body: lines.slice(index + 1, closeIndex).join("\n") });
  }
  if (candidates.length !== 1) fail("POINTER_MAIN_COUNT", "expected exactly one exact-id persona main block");
  const candidate = candidates.at(-1);
  if (candidate.closeIndex >= 0 && lines.slice(candidate.closeIndex + 1).some((line) => line.trim() !== "")) {
    fail("POINTER_NOT_FINAL", "exact-id main block is not the final response block");
  }
  if (lines[0] !== `Memory [${expectedId}]`) fail("POINTER_HEADER_MISSING", "first response line does not name the exact requested memory");
  return { id: expectedId, persona: expectedPersona, body: candidate.body, digest: sha256(Buffer.from(candidate.body, "utf8")) };
}

function deepStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const child of value) deepStrings(child, output);
  else if (isObject(value)) for (const child of Object.values(value)) deepStrings(child, output);
  return output;
}

export function verifyExactMailFetch(records, { rowId, bodyNonce, persona = "codex-n0" }) {
  requireSafeInteger(rowId, "MAIL_ROW_INVALID", "mail row id");
  requireNonce(bodyNonce, "MAIL_NONCE_INVALID", "mail body nonce");
  const matches = [];
  for (const record of records) {
    const payload = record?.payload;
    const invocation = payload?.invocation;
    if (payload?.type !== "mcp_tool_call_end" || invocation?.tool !== "kijito_hive_inbox") continue;
    const args = invocation.arguments ?? {};
    if (args.persona !== persona || args.before_id !== rowId + 1 || args.limit !== 1 || args.mark_read !== false) continue;
    const strings = deepStrings(payload.result);
    if (strings.some((text) => text.includes(`msg ${rowId} [${persona} -> ${persona}]`) && text.includes(bodyNonce))) matches.push(record);
  }
  if (matches.length !== 1) fail("MAIL_FETCH_PROOF", "expected exactly one exact non-mutating mail fetch artifact containing the withheld body nonce");
  return true;
}

export function assertSecretsAbsent(surfaces, secrets) {
  for (const [name, value] of Object.entries(surfaces)) {
    const text = typeof value === "string" ? value : stableJson(value);
    for (const [secretName, secret] of Object.entries(secrets)) {
      if (secret && text.includes(secret)) fail("WITHHELD_SECRET_LEAK", `${secretName} leaked into ${name}`);
    }
  }
  return true;
}

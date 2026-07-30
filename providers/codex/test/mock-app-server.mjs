import fs from "node:fs";
import readline from "node:readline";

let threadId = process.env.MOCK_THREAD_ID || "mock-thread-1";
let turn = 0;

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function trace(value) {
  if (process.env.MOCK_TRACE_FILE) fs.appendFileSync(process.env.MOCK_TRACE_FILE, `${JSON.stringify(value)}\n`);
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  trace(msg);
  if (msg.method === "initialized") return;
  if (msg.method === "initialize") {
    emit({ id: msg.id, result: { codexHome: process.env.CODEX_HOME } });
  } else if (msg.method === "hooks/list") {
    const hooks = process.env.MOCK_HOOK_CONTAMINATION ? [{ event: "mock-lifecycle" }] : [];
    emit({ id: msg.id, result: { data: [{ cwd: msg.params.cwds[0], hooks, warnings: [], errors: [] }] } });
  } else if (msg.method === "thread/start" || msg.method === "thread/resume") {
    if (msg.method === "thread/resume") threadId = msg.params.threadId;
    if (msg.method === "thread/resume" && process.env.MOCK_WRONG_RESUME) threadId = `${threadId}-wrong`;
    emit({ id: msg.id, result: {
      thread: { id: threadId, cwd: msg.params.cwd, status: { type: "idle" } },
      cwd: msg.params.cwd,
      activePermissionProfile: { id: msg.params.permissions },
      instructionSources: [],
    } });
  } else if (msg.method === "mcpServerStatus/list") {
    emit({ id: msg.id, result: { data: [{ name: "kijito", authStatus: "bearerToken", resources: [], resourceTemplates: [], tools: { kijito_hive_inbox: {} } }], nextCursor: null } });
  } else if (msg.method === "turn/start") {
    turn += 1;
    const turnId = `mock-turn-${turn}`;
    emit({ id: msg.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
    emit({ method: "thread/status/changed", params: { threadId, status: { type: "active", activeFlags: [] } } });
    emit({ method: "turn/started", params: { turn: { id: turnId, status: "inProgress" } } });
    emit({ method: "item/agentMessage/delta", params: { threadId, turnId, delta: "MOCK_SURFACED" } });
    const idleMarker = process.env.MOCK_SKIP_IDLE_ONCE_MARKER;
    const skipIdle = idleMarker && !fs.existsSync(idleMarker);
    if (skipIdle) fs.writeFileSync(idleMarker, "skipped\n");
    else emit({ method: "thread/status/changed", params: { threadId, status: { type: "idle" } } });
    emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
  } else {
    emit({ id: msg.id, error: { code: -32601, message: `unknown ${msg.method}` } });
  }
});

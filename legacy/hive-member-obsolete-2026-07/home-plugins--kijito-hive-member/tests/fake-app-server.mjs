import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const flags = new Set(args);
const logIndex = args.indexOf("--log");
const logPath = logIndex >= 0 ? args[logIndex + 1] : null;

function record(message) {
  if (logPath) fs.appendFileSync(logPath, `${JSON.stringify(message)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

record({
  kind: "environment",
  home: process.env.HOME || null,
  codexHome: process.env.CODEX_HOME || null,
  leakedOpenAiKey: Object.hasOwn(process.env, "OPENAI_API_KEY"),
  leakedKijitoToken: Object.hasOwn(process.env, "KIJITO_API_TOKEN"),
});

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  record(message);
  if (message.id === undefined) return;
  const { id, method, params } = message;
  if (method === "initialize") {
    send({ id, result: { serverInfo: { name: "fake", version: "0.145.0" } } });
  } else if (method === "model/list") {
    send({
      id,
      result: {
        data: [
          {
            id: "fake-default",
            model: "fake-default",
            displayName: "Fake Default",
            description: "test",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [],
          },
        ],
        nextCursor: null,
      },
    });
  } else if (method === "thread/resume") {
    if (process.env.FAKE_FAIL_RESUME === "1") {
      send({ id, error: { code: -32000, message: "not found" } });
    } else {
      send({ id, result: { thread: { id: params.threadId } } });
    }
  } else if (method === "thread/start") {
    send({ id, result: { thread: { id: "thr_fake_new" } } });
  } else if (method === "turn/start") {
    const turnId = `turn_${Date.now()}`;
    send({ id, result: { turn: { id: turnId } } });
    if (flags.has("--tool-activity")) {
      send({
        method: "item/started",
        params: {
          threadId: params.threadId,
          turnId,
          item: { id: "tool_fake", type: "mcpToolCall" },
        },
      });
    }
    const draft = flags.has("--invalid-draft")
      ? {
        summary: "Unsafe schema",
        recommendedAction: "draft_for_user_review",
        draftReply: "Draft reply",
        sendAllowed: true,
      }
      : {
        summary: "Safe summary",
        recommendedAction: "draft_for_user_review",
        draftReply: "Draft reply",
        sendAllowed: false,
      };
    send({
      method: "item/agentMessage/delta",
      params: {
        threadId: params.threadId,
        turnId,
        itemId: "item_fake",
        delta: flags.has("--oversize-draft")
          ? "x".repeat(70 * 1024)
          : JSON.stringify(draft),
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: params.threadId,
        turn: { id: turnId, status: "completed" },
      },
    });
  } else if (method === "hooks/list" || method === "mcpServerStatus/list") {
    send({ id, result: { data: [] } });
  } else if (method === "permissionProfile/list") {
    send({ id, result: { data: [{ id: ":read-only" }] } });
  } else if (method === "configRequirements/read") {
    send({ id, result: { requirements: {} } });
  } else {
    send({ id, error: { code: -32601, message: `unsupported fake method: ${method}` } });
  }
});

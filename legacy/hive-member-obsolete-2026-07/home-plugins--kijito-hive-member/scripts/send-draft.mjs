#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { errorCode } from "./io.mjs";
import { loadSafetyPolicy } from "./safety.mjs";
import {
  approvalPhrase,
  loadManualDraft,
  sendManualDraft,
} from "./outbound.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.dirname(scriptDir);

function parseArgs(argv) {
  const options = {
    draftPath: null,
    persona: process.env.KIJITO_PERSONA || "codex",
    dataDir: process.env.KIJITO_CODEX_DATA_DIR || process.env.PLUGIN_DATA
      || path.join(os.homedir(), ".cache", "kijito-codex-bridge"),
    tokenFile: process.env.KIJITO_TOKEN_FILE
      || path.join(os.homedir(), ".config", "kijito-inbox-monitor", "token"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--draft") options.draftPath = argv[++index];
    else if (arg === "--persona") options.persona = argv[++index];
    else if (arg === "--data-dir") options.dataDir = argv[++index];
    else if (arg === "--token-file") options.tokenFile = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.draftPath) throw new Error("--draft is required");
  return options;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw Object.assign(new Error("manual send approval requires an interactive TTY"), {
      code: "manual_approval_tty_required",
    });
  }
  const options = parseArgs(process.argv.slice(2));
  const policy = loadSafetyPolicy(path.join(pluginRoot, "scripts", "safety-policy.json"));
  const proposal = loadManualDraft({ ...options, policy });
  const expected = approvalPhrase(proposal);
  process.stdout.write(
    `\nOutbound Kijito draft\nFrom: ${proposal.payload.from}\n`
      + `To: ${proposal.payload.to}\nSource message: ${proposal.payload.sourceMessageId}\n`
      + `SHA-256: ${proposal.digest}\n\n${proposal.payload.content}\n\n`,
  );
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const entered = await prompt.question(`Type exactly "${expected}" to send once: `);
  prompt.close();
  const result = await sendManualDraft({
    ...options,
    policy,
    enteredApprovalPhrase: entered,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${errorCode(error)}\n`);
    process.exitCode = 1;
  }
}

export { main, parseArgs };

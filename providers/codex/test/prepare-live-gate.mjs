import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-c3-live."));
const codexHome = path.join(root, "codex-home");
const workspace = path.join(root, "empty-workspace");
const runtime = path.join(root, "runtime");
fs.chmodSync(root, 0o700);
for (const directory of [codexHome, workspace, runtime]) fs.mkdirSync(directory, { mode: 0o700 });

const authSource = path.join(os.homedir(), ".codex", "auth.json");
const authTarget = path.join(codexHome, "auth.json");
fs.copyFileSync(authSource, authTarget, fs.constants.COPYFILE_EXCL);
fs.chmodSync(authTarget, 0o600);

const config = [
  'approval_policy = "never"',
  'default_permissions = "hive-read"',
  'web_search = "disabled"',
  '',
  '[features]',
  'apps = false',
  'goals = false',
  'hooks = false',
  'multi_agent = false',
  'remote_plugin = false',
  'shell_snapshot = false',
  'shell_tool = false',
  'unified_exec = false',
  '',
  '[permissions.hive-read.filesystem]',
  '":root" = "deny"',
  '":minimal" = "read"',
  '',
  '[permissions.hive-read.filesystem.":workspace_roots"]',
  '"." = "read"',
  '',
  '[permissions.hive-read.network]',
  'enabled = false',
  '',
  '[mcp_servers.kijito]',
  'url = "https://api.kijito.ai/mcp/"',
  'bearer_token_env_var = "KIJITO_API_TOKEN"',
  'enabled = true',
  'required = true',
  'enabled_tools = ["kijito_hive_inbox"]',
  'default_tools_approval_mode = "approve"',
  'startup_timeout_sec = 30',
  'tool_timeout_sec = 60',
  '',
].join("\n");
const configFile = path.join(codexHome, "config.toml");
fs.writeFileSync(configFile, config, { mode: 0o600, flag: "wx" });

console.log(JSON.stringify({
  root,
  codexHome,
  workspace,
  runtime,
  stateFile: path.join(runtime, "state.json"),
  lockFile: path.join(runtime, "consumer.lock"),
  eventsFile: path.join(os.homedir(), ".cache", "kijito-inbox-monitor", "events.codex.ndjson"),
  tokenFile: path.join(os.homedir(), ".claude", ".kijito_api_token"),
}, null, 2));

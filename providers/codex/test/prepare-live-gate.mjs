import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConsumerLockFile } from "../controller.mjs";

export function assertNoLegacyConsumer(lockFile) {
  try { fs.lstatSync(lockFile); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  // The legacy and canonical controllers use different lock locations. Any legacy lock is an
  // unresolved ownership boundary (live, stale, or unverifiable), so this live-gate helper must
  // fail closed rather than risk arming cross-version consumers on the same real event stream.
  throw new Error(`refusing live gate while legacy consumer lock exists: ${lockFile}; stop or migrate the legacy controller first`);
}

export const LIVE_GATE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const LIVE_GATE_PREFIX = "codex-kijito-c3-live.";

function removableLiveGate(root, tempRoot) {
  const resolvedParent = fs.realpathSync(path.dirname(root));
  if (resolvedParent !== fs.realpathSync(tempRoot) || !path.basename(root).startsWith(LIVE_GATE_PREFIX)) return false;
  const stat = fs.lstatSync(root);
  return stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0;
}

export function cleanupLiveGate(root, tempRoot = os.tmpdir()) {
  if (!removableLiveGate(root, tempRoot)) throw new Error(`refusing unsafe live-gate cleanup target: ${root}`);
  fs.rmSync(root, { recursive: true, force: false });
  return { status: "REMOVED", root };
}

function liveGateControllerActive(root) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root, "runtime", "state.json"), "utf8"));
    if (!Number.isSafeInteger(state.controllerPid) || state.controllerPid <= 1) return false;
    try { process.kill(state.controllerPid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  } catch { return false; }
}

export function pruneExpiredLiveGates({ tempRoot = os.tmpdir(), now = Date.now(), maxAgeMs = LIVE_GATE_MAX_AGE_MS } = {}) {
  const result = { removed: [], warnings: [] };
  for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(LIVE_GATE_PREFIX) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const root = path.join(tempRoot, entry.name);
    try {
      const stat = fs.lstatSync(root);
      if (now - stat.mtimeMs < maxAgeMs || !removableLiveGate(root, tempRoot) || liveGateControllerActive(root)) continue;
      cleanupLiveGate(root, tempRoot);
      result.removed.push(root);
    } catch (error) {
      result.warnings.push({ root, code: error.code ?? null, message: error.message });
    }
  }
  return result;
}

export function prepareLiveGate(home = os.homedir(), tempRoot = os.tmpdir()) {
  const retention = pruneExpiredLiveGates({ tempRoot });
  const legacyLockFile = path.join(home, ".local", "share", "codex-kijito-hive", "runtime", "consumer.lock");
  assertNoLegacyConsumer(legacyLockFile);
  const root = fs.mkdtempSync(path.join(tempRoot, LIVE_GATE_PREFIX));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "empty-workspace");
  const runtime = path.join(root, "runtime");
  const eventsFile = path.join(home, ".cache", "kijito-inbox-monitor", "events.codex.ndjson");
  const lockFile = defaultConsumerLockFile(eventsFile);
  try {
    fs.chmodSync(root, 0o700);
    for (const directory of [codexHome, workspace, runtime]) fs.mkdirSync(directory, { mode: 0o700 });
    fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });

    const authSource = path.join(home, ".codex", "auth.json");
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

    return {
      root,
      codexHome,
      workspace,
      runtime,
      stateFile: path.join(runtime, "state.json"),
      lockFile,
      eventsFile,
      tokenFile: path.join(home, ".claude", ".kijito_api_token"),
      expiresAfterMs: LIVE_GATE_MAX_AGE_MS,
      cleanup: { command: process.execPath, args: [fileURLToPath(import.meta.url), "--cleanup", root] },
      retention,
    };
  } catch (error) {
    try { cleanupLiveGate(root, tempRoot); } catch {}
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--cleanup" && process.argv.length === 4) {
    console.log(JSON.stringify(cleanupLiveGate(path.resolve(process.argv[3])), null, 2));
  } else if (process.argv.length === 2) {
    console.log(JSON.stringify(prepareLiveGate(), null, 2));
  } else {
    throw new Error("usage: prepare-live-gate.mjs [--cleanup <root>]");
  }
}

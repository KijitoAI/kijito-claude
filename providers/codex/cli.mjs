#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installRoot = path.dirname(fileURLToPath(import.meta.url));
const manifestFile = path.join(installRoot, "installed-manifest.json");
// Mirrors the repo layout (providers/codex/controller.mjs + providers/_shared/wake-core.mjs) so the
// controller's import specifier is the same in the repo and in the install.
const controllerFile = path.join(installRoot, "codex", "controller.mjs");
const wakeCoreFile = path.join(installRoot, "_shared", "wake-core.mjs");

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadManifest() {
  const stat = fs.lstatSync(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error("installed manifest is not private and user-owned");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.schema !== 1 || manifest.product !== "codex-kijito-hive" || manifest.paths.installRoot !== installRoot) throw new Error("installed manifest identity mismatch");
  return manifest;
}

function checkRealPrivateDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error(`${label} is not a private user-owned real directory`);
}

function checkPrivateFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error(`${label} is not one private user-owned regular file`);
}

function optionalHash(file) {
  try { return sha256(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

const HEARTBEAT_STALE_MS = 15_000;
const DELIVERY_STALE_MS = 180_000;

function processCommand(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return {
    command: result.status === 0 ? result.stdout.trim() : "",
    error: result.error?.code ?? (result.status === 0 ? null : "ps-failed"),
  };
}

function readRuntimeState(manifest) {
  const stateFile = path.join(manifest.paths.runtime, "state.json");
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.schema !== 1 || state.persona !== "codex") throw new Error("runtime state identity mismatch");
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function freshHeartbeat(state, pid, now = Date.now()) {
  const at = Date.parse(state?.heartbeatAt ?? "");
  const age = now - at;
  return state?.controllerPid === pid && Number.isFinite(at) && age >= -5_000 && age <= HEARTBEAT_STALE_MS;
}

function heartbeatOwnsLock(state, lock) {
  if (typeof state?.lockTokenHash !== "string" || typeof lock.token !== "string") return false;
  return state.lockTokenHash === createHash("sha256").update(lock.token).digest("hex");
}

export function lockStatus(manifest, now = Date.now(), probes = { kill: process.kill.bind(process), command: processCommand }) {
  const lockFile = path.join(manifest.paths.runtime, "consumer.lock");
  let lock;
  try { lock = JSON.parse(fs.readFileSync(lockFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { state: "stopped", lockFile }; throw error; }
  if (!Number.isSafeInteger(lock.pid) || lock.pid <= 1 || typeof lock.token !== "string" || lock.persona !== "codex") return { state: "invalid-lock", lockFile };
  let signalProbe = "alive";
  try { probes.kill(lock.pid, 0); }
  catch (error) {
    if (error.code === "ESRCH") return { state: "stale-lock", pid: lock.pid, lockFile };
    signalProbe = error.code ?? "unknown-error";
  }
  const probe = probes.command(lock.pid);
  if (probe.command && !probe.command.includes(controllerFile)) {
    return { state: "pid-mismatch", pid: lock.pid, command: probe.command, lockFile };
  }
  if (probe.command) return { state: "running", pid: lock.pid, command: probe.command, evidence: "process-command", lockFile };
  const runtime = readRuntimeState(manifest);
  if (freshHeartbeat(runtime, lock.pid, now) && heartbeatOwnsLock(runtime, lock)) {
    return { state: "running", pid: lock.pid, command: null, evidence: "private-heartbeat", signalProbe, commandProbe: probe.error, lockFile };
  }
  return { state: "unverifiable-lock", pid: lock.pid, signalProbe, commandProbe: probe.error, lockFile };
}

export function runtimeHealth(manifest, controller, now = Date.now()) {
  const state = readRuntimeState(manifest);
  const reasons = [];
  if (!["running", "stopped"].includes(controller.state)) reasons.push(`controller ownership is ${controller.state}`);
  if (state?.ambiguous) reasons.push(`delivery ambiguous since ${state.ambiguous.at ?? "unknown"}: ${state.ambiguous.reason ?? "unknown"}`);
  if (state?.degraded) reasons.push(`controller degraded since ${state.degraded.at ?? "unknown"}: ${state.degraded.reason ?? "unknown"}`);
  if (state?.recovery) reasons.push(`recovery incomplete since ${state.recovery.at ?? "unknown"}`);
  if (controller.state === "running") {
    if (!state?.armedAt) reasons.push("controller has not recorded armed state");
    if (!freshHeartbeat(state, controller.pid, now)) reasons.push("controller heartbeat is stale or belongs to another pid");
  }
  const pendingAt = Date.parse(state?.pendingSince ?? "");
  if (Number.isFinite(pendingAt) && now - pendingAt > DELIVERY_STALE_MS) {
    reasons.push(`relevant event pending without a successful surface since ${state.pendingSince}`);
  }
  return {
    status: reasons.length === 0 ? (controller.state === "running" ? "ARMED" : "INACTIVE") : "RED",
    reasons,
    state,
  };
}

export function assertArmedHealth(wake) {
  if (wake.status !== "ARMED") {
    throw new Error(`startup is not armed: ${wake.status}${wake.reasons.length ? `: ${wake.reasons.join("; ")}` : ""}`);
  }
  return wake;
}

function doctor(manifest) {
  checkRealPrivateDirectory(installRoot, "install root");
  checkRealPrivateDirectory(manifest.paths.codexHome, "dedicated Codex home");
  checkRealPrivateDirectory(manifest.paths.workspace, "dedicated workspace");
  checkRealPrivateDirectory(manifest.paths.runtime, "runtime directory");
  checkRealPrivateDirectory(path.dirname(controllerFile), "controller directory");
  checkRealPrivateDirectory(path.dirname(wakeCoreFile), "shared wake-core directory");
  if (fs.readdirSync(manifest.paths.workspace).length !== 0) throw new Error("dedicated workspace is not empty");
  const files = {
    controller: controllerFile,
    wakeCore: wakeCoreFile,
    cli: path.join(installRoot, "cli.mjs"),
    config: path.join(manifest.paths.codexHome, "config.toml"),
    auth: path.join(manifest.paths.codexHome, "auth.json"),
    launcher: manifest.paths.launcher,
    token: manifest.paths.tokenFile,
  };
  for (const [label, file] of Object.entries(files)) checkPrivateFile(file, label);
  for (const [label, expected] of [
    ["controller", manifest.hashes.controllerSha256],
    ["wakeCore", manifest.hashes.wakeCoreSha256],
    ["cli", manifest.hashes.cliSha256],
    ["config", manifest.hashes.configSha256],
    ["auth", manifest.hashes.authSha256],
    ["launcher", manifest.hashes.launcherSha256],
  ]) if (sha256(files[label]) !== expected) throw new Error(`${label} hash mismatch`);
  const config = fs.readFileSync(files.config, "utf8");
  if (!config.includes("hooks = false") || config.includes("[hooks") || config.includes("LaunchAgent") || config.includes("KeepAlive")) throw new Error("dedicated config violates the no-hooks boundary");
  const token = fs.readFileSync(files.token, "utf8").trim();
  if (!token.startsWith("kjt_") || token.length < 20) throw new Error("token file is not a Kijito token");
  const eventExists = fs.existsSync(manifest.paths.eventsFile);
  if (eventExists) checkPrivateFile(manifest.paths.eventsFile, "monitor event stream");
  const ordinaryNow = {
    configSha256: optionalHash(manifest.paths.ordinaryConfig),
    authSha256: optionalHash(manifest.paths.ordinaryAuth),
  };
  const ordinaryStateMatchesInstallSnapshot = ordinaryNow.configSha256 === manifest.hashes.ordinaryConfigBeforeSha256
    && ordinaryNow.authSha256 === manifest.hashes.ordinaryAuthBeforeSha256;
  const status = lockStatus(manifest);
  const wake = runtimeHealth(manifest, status);
  return {
    status: wake.status === "RED" ? "RED" : "GREEN",
    product: manifest.product,
    version: manifest.version,
    controllerSha256: manifest.hashes.controllerSha256,
    wakeCoreSha256: manifest.hashes.wakeCoreSha256,
    hooksDisabled: true,
    launchAgentInstalled: false,
    workspaceEmpty: true,
    eventStreamReady: eventExists,
    ordinaryStateMatchesInstallSnapshot,
    controller: status,
    wake: { status: wake.status, reasons: wake.reasons },
  };
}

function controllerArgs(manifest) {
  return [
    controllerFile,
    "--codex-home", manifest.paths.codexHome,
    "--workspace", manifest.paths.workspace,
    "--runtime", manifest.paths.runtime,
    "--events", manifest.paths.eventsFile,
    "--token-file", manifest.paths.tokenFile,
    "--codex", manifest.paths.codexBin,
    "--poll-ms", "500",
  ];
}

function safeEnv() {
  return {
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
  };
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out`);
}

async function start(manifest) {
  const before = lockStatus(manifest);
  if (before.state !== "stopped") throw new Error(`controller cannot start from state ${before.state}`);
  const logFile = path.join(manifest.paths.runtime, "controller.ndjson");
  const logOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const fd = fs.openSync(logFile, "a", 0o600);
  fs.chmodSync(logFile, 0o600);
  let child;
  try {
    child = spawn(process.execPath, controllerArgs(manifest), {
      cwd: manifest.paths.workspace,
      detached: true,
      env: safeEnv(),
      stdio: ["ignore", fd, fd],
    });
    child.unref();
  } finally { fs.closeSync(fd); }
  const running = await waitFor(() => {
    const current = lockStatus(manifest);
    if (["invalid-lock", "stale-lock", "pid-mismatch"].includes(current.state)) throw new Error(`controller entered ${current.state}`);
    return current.state === "running" ? current : null;
  }, 10_000, "controller ownership");
  const armed = await waitArmed(manifest, 180_000, logOffset);
  return { status: "ARMED", ...running, logFile, logOffset, armed };
}

async function stop(manifest) {
  const current = lockStatus(manifest);
  if (current.state === "stopped") return { status: "ALREADY_STOPPED" };
  if (current.state !== "running") throw new Error(`refusing to signal controller in state ${current.state}`);
  process.kill(current.pid, "SIGTERM");
  await waitFor(() => lockStatus(manifest).state === "stopped", 30_000, "controller shutdown");
  return { status: "STOPPED", pid: current.pid };
}

async function waitArmed(manifest, timeoutMs = 180_000, logOffset = 0) {
  const logFile = path.join(manifest.paths.runtime, "controller.ndjson");
  return waitFor(() => {
    let bytes;
    try { bytes = fs.readFileSync(logFile); } catch { return null; }
    if (bytes.length < logOffset) throw new Error("controller log truncated after start");
    const text = bytes.subarray(logOffset).toString("utf8");
    const rows = text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const armed = rows.findLast((row) => row.event === "armed");
    const ambiguous = rows.findLast((row) => row.event === "ambiguous");
    const degraded = rows.findLast((row) => row.event === "degraded");
    if (ambiguous && (!armed || ambiguous.ts > armed.ts)) throw new Error(`startup became ambiguous: ${ambiguous.reason}`);
    if (degraded && (!armed || degraded.ts > armed.ts)) throw new Error(`startup became degraded: ${degraded.reason}`);
    if (!armed) return null;
    const current = lockStatus(manifest);
    const wake = runtimeHealth(manifest, current);
    assertArmedHealth(wake);
    return armed;
  }, timeoutMs, "controller armed state");
}

async function uninstall(manifest, confirmed) {
  if (!confirmed) throw new Error("uninstall requires --confirm-dedicated-home");
  await stop(manifest);
  if (sha256(manifest.paths.launcher) !== manifest.hashes.launcherSha256) throw new Error("refusing to remove modified launcher");
  const root = path.resolve(manifest.paths.installRoot);
  if (root !== installRoot || root === path.parse(root).root || path.basename(root) !== "codex-kijito-hive") throw new Error("refusing unsafe install root");
  fs.unlinkSync(manifest.paths.launcher);
  fs.rmSync(root, { recursive: true, force: false });
  return { status: "UNINSTALLED", removed: [root, manifest.paths.launcher], recoverable: false };
}

async function main() {
  const manifest = loadManifest();
  const [command = "status", ...rest] = process.argv.slice(2);
  let result;
  if (command === "doctor") result = doctor(manifest);
  else if (command === "status") {
    const controller = lockStatus(manifest);
    const wake = runtimeHealth(manifest, controller);
    result = { status: controller, wake: { status: wake.status, reasons: wake.reasons } };
  }
  else if (command === "run") {
    const child = spawn(process.execPath, controllerArgs(manifest), { cwd: manifest.paths.workspace, env: safeEnv(), stdio: "inherit" });
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    const [code, signal] = await new Promise((resolve) => child.once("exit", (c, s) => resolve([c, s])));
    if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1;
    return;
  } else if (command === "start") result = await start(manifest);
  else if (command === "stop") result = await stop(manifest);
  else if (command === "smoke") {
    const started = await start(manifest);
    try { result = { status: "GREEN", started, armed: started.armed }; }
    finally { await stop(manifest); }
  } else if (command === "wait-armed") result = { status: "ARMED", event: await waitArmed(manifest) };
  else if (command === "uninstall") result = await uninstall(manifest, rest.includes("--confirm-dedicated-home"));
  else throw new Error(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result?.status === "RED" || result?.wake?.status === "RED") process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

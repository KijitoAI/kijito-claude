#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const installRoot = path.dirname(fileURLToPath(import.meta.url));
const manifestFile = path.join(installRoot, "installed-manifest.json");
// Mirrors the repo layout (providers/codex/controller.mjs + providers/_shared/wake-core.mjs) so the
// controller's import specifier is the same in the repo and in the install.
const controllerFile = path.join(installRoot, "codex", "controller.mjs");
const wakeCoreFile = path.join(installRoot, "_shared", "wake-core.mjs");
// An installed CLI is identified by its private manifest and must never fall back outside that
// install root when the installed shared core is missing. The sibling path exists only for direct
// imports from the repository layout, where no installed manifest exists beside this file.
const wakeCoreModuleFile = fs.existsSync(manifestFile) ? wakeCoreFile : path.join(installRoot, "..", "_shared", "wake-core.mjs");
let coreDefaultConsumerLockFile;
let wakeCoreImportError = null;
try {
  ({ defaultConsumerLockFile: coreDefaultConsumerLockFile } = await import(pathToFileURL(wakeCoreModuleFile)));
} catch (error) { wakeCoreImportError = error; }
const defaultConsumerLockFile = (eventsFile) => {
  if (wakeCoreImportError) throw wakeCoreImportError;
  return coreDefaultConsumerLockFile(eventsFile, "codex");
};

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

function checkRealOwnedNonWritableDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) {
    throw new Error(`${label} is not a user-owned, non-group/other-writable real directory`);
  }
}

function checkPrivateFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error(`${label} is not one private user-owned regular file`);
}

function checkExecutableTarget(file, label) {
  const resolved = fs.realpathSync(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) throw new Error(`${label} target is not an executable regular file`);
  return resolved;
}

function optionalHash(file) {
  try { return sha256(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

const HEARTBEAT_STALE_MS = 15_000;
const DELIVERY_STALE_MS = 180_000;

function processCommand(pid) {
  const result = spawnSync("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
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

function lockFileFor(manifest) {
  return manifest.paths.lockFile
    ?? (manifest.paths.eventsFile ? defaultConsumerLockFile(manifest.paths.eventsFile) : path.join(manifest.paths.runtime, "consumer.lock"));
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
  const lockFile = lockFileFor(manifest);
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
  let runtime;
  try { runtime = readRuntimeState(manifest); }
  catch (error) { return { state: "invalid-state", pid: lock.pid, reason: error.message, lockFile }; }
  if (freshHeartbeat(runtime, lock.pid, now) && heartbeatOwnsLock(runtime, lock)) {
    return { state: "running", pid: lock.pid, command: null, evidence: "private-heartbeat", signalProbe, commandProbe: probe.error, lockFile };
  }
  return { state: "unverifiable-lock", pid: lock.pid, signalProbe, commandProbe: probe.error, lockFile };
}

export function reapStaleLock(manifest, now = Date.now(), probes = { kill: process.kill.bind(process), command: processCommand }) {
  const before = lockStatus(manifest, now, probes);
  if (before.state !== "stale-lock") throw new Error(`refusing to reap controller lock in state ${before.state}`);
  checkPrivateFile(before.lockFile, "stale consumer lock");
  const first = fs.readFileSync(before.lockFile, "utf8");
  const lock = JSON.parse(first);
  if (lock.pid !== before.pid || typeof lock.token !== "string" || lock.persona !== "codex") throw new Error("stale lock changed before reaping");
  const quarantine = `${before.lockFile}.stale.${process.pid}.${Date.now()}`;
  fs.renameSync(before.lockFile, quarantine);
  try {
    checkPrivateFile(quarantine, "quarantined stale consumer lock");
    if (fs.readFileSync(quarantine, "utf8") !== first) throw new Error("stale lock changed before quarantine");
    fs.unlinkSync(quarantine);
  } catch (error) {
    try { if (!fs.existsSync(before.lockFile)) fs.renameSync(quarantine, before.lockFile); } catch {}
    throw error;
  }
  return { state: "reaped-stale-lock", pid: before.pid, lockFile: before.lockFile };
}

export function runtimeHealth(manifest, controller, now = Date.now()) {
  let state = null;
  const reasons = [];
  try { state = readRuntimeState(manifest); }
  catch (error) { reasons.push(`runtime state is unreadable: ${error.message}`); }
  if (!["running", "stopped"].includes(controller.state)) reasons.push(`controller ownership is ${controller.state}`);
  if (state?.ambiguous) reasons.push(`delivery ambiguous since ${state.ambiguous.at ?? "unknown"}: ${state.ambiguous.reason ?? "unknown"}`);
  if (state?.degraded) reasons.push(`controller degraded since ${state.degraded.at ?? "unknown"}: ${state.degraded.reason ?? "unknown"}`);
  if (state?.recovery) reasons.push(`recovery incomplete since ${state.recovery.at ?? "unknown"}`);
  if (controller.state === "running") {
    if (!state?.armedAt) reasons.push("controller has not recorded armed state");
    if (!state?.controllerRunId || state.armedRunId !== state.controllerRunId) reasons.push("armed state belongs to a different controller run");
    if (!state?.armAttemptId || state.armedAttemptId !== state.armAttemptId) reasons.push("armed state belongs to a different arming attempt");
    if (!freshHeartbeat(state, controller.pid, now)) reasons.push("controller heartbeat is stale or belongs to another pid");
    if (!["idle", "active"].includes(state?.clientStatus)) reasons.push(`owned app-server is ${state?.clientStatus ?? "unknown"}`);
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

function inspectDoctor(manifest) {
  const expectedLockFile = defaultConsumerLockFile(manifest.paths.eventsFile);
  if (lockFileFor(manifest) !== expectedLockFile) throw new Error("manifest consumer lock is not the deterministic lock under the event-stream directory");
  checkRealPrivateDirectory(installRoot, "install root");
  checkRealPrivateDirectory(manifest.paths.codexHome, "dedicated Codex home");
  checkRealPrivateDirectory(manifest.paths.workspace, "dedicated workspace");
  checkRealPrivateDirectory(manifest.paths.runtime, "runtime directory");
  checkRealOwnedNonWritableDirectory(path.dirname(manifest.paths.eventsFile), "monitor event directory");
  checkRealPrivateDirectory(path.dirname(lockFileFor(manifest)), "package-owned consumer-lock directory");
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
  const codexResolvedNow = checkExecutableTarget(manifest.paths.codexBin, "Codex binary");
  const codexTargetChanged = typeof manifest.paths.codexResolvedAtInstall === "string"
    && codexResolvedNow !== manifest.paths.codexResolvedAtInstall;
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
  const integrityReasons = [];
  if (!eventExists) integrityReasons.push("monitor event stream is unavailable");
  if (!ordinaryStateMatchesInstallSnapshot) integrityReasons.push("ordinary Codex state differs from the install snapshot");
  const overallStatus = integrityReasons.length === 0 ? wake.status : "RED";
  return {
    status: overallStatus,
    product: manifest.product,
    version: manifest.version,
    controllerSha256: manifest.hashes.controllerSha256,
    wakeCoreSha256: manifest.hashes.wakeCoreSha256,
    hooksDisabled: true,
    launchAgentInstalled: false,
    workspaceEmpty: true,
    eventStreamReady: eventExists,
    codexBin: manifest.paths.codexBin,
    codexResolvedNow,
    codexTargetChanged,
    ordinaryStateMatchesInstallSnapshot,
    controller: status,
    reasons: [...integrityReasons, ...wake.reasons],
    wake: { status: wake.status, reasons: wake.reasons },
  };
}

function failureCategory(error) {
  const message = String(error?.message ?? error);
  if (error instanceof SyntaxError
    || ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "ERR_MODULE_NOT_FOUND"].includes(error?.code)) return "integrity";
  if (error instanceof CliUsageError) return "usage";
  if (/controller|ownership|lock|arming|armed state|shutdown|app-server/.test(message)) return "ownership";
  if (/manifest|hash mismatch|private|user-owned|directory|file|token|workspace|event stream|ordinary Codex|executable/.test(message)) {
    return "integrity";
  }
  return "operation";
}

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

function doctorFailure(manifest, error, command = "doctor") {
  const category = failureCategory(error);
  const reason = `${category} failure: ${error.message}`;
  const stack = typeof error?.stack === "string" ? error.stack : null;
  return {
    status: "RED",
    command,
    failure: { category, message: error.message, code: error.code ?? null, stack },
    product: manifest?.product ?? "codex-kijito-hive",
    version: manifest?.version ?? null,
    controllerSha256: manifest?.hashes?.controllerSha256 ?? null,
    wakeCoreSha256: manifest?.hashes?.wakeCoreSha256 ?? null,
    hooksDisabled: null,
    launchAgentInstalled: null,
    workspaceEmpty: null,
    eventStreamReady: null,
    ordinaryStateMatchesInstallSnapshot: null,
    controller: { state: "unknown" },
    reasons: [reason],
    wake: category === "usage"
      ? { status: "UNKNOWN", reasons: ["command was not executed"] }
      : { status: "RED", reasons: [reason] },
  };
}

export function doctor(manifest) {
  try { return inspectDoctor(manifest); }
  catch (error) { return doctorFailure(manifest, error, "doctor"); }
}

function controllerArgs(manifest) {
  return [
    controllerFile,
    "--codex-home", manifest.paths.codexHome,
    "--workspace", manifest.paths.workspace,
    "--runtime", manifest.paths.runtime,
    "--events", manifest.paths.eventsFile,
    "--lock", lockFileFor(manifest),
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

export async function start(manifest) {
  let before = lockStatus(manifest);
  if (before.state === "stale-lock") {
    reapStaleLock(manifest);
    before = lockStatus(manifest);
  }
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
  try {
    const running = await waitFor(() => {
      const current = lockStatus(manifest);
      if (["invalid-lock", "stale-lock", "pid-mismatch", "unverifiable-lock", "invalid-state"].includes(current.state)) throw new Error(`controller entered ${current.state}`);
      return current.state === "running" ? current : null;
    }, 10_000, "controller ownership");
    const expectedRun = await waitFor(() => {
      const runtime = readRuntimeState(manifest);
      return runtime?.controllerPid === running.pid && runtime.controllerRunId && runtime.armAttemptId
        ? { runId: runtime.controllerRunId, armAttemptId: runtime.armAttemptId }
        : null;
    }, 10_000, "controller arming generation");
    const armed = await waitArmed(manifest, 180_000, logOffset, expectedRun);
    return { status: "ARMED", ...running, logFile, logOffset, armed };
  } catch (error) {
    try { await stop(manifest); } catch {}
    throw error;
  }
}

export async function stop(manifest, probes = { kill: process.kill.bind(process), command: processCommand }) {
  let current = lockStatus(manifest, Date.now(), probes);
  if (current.state === "stopped") return { status: "ALREADY_STOPPED" };
  if (current.state === "stale-lock") {
    const reaped = reapStaleLock(manifest, Date.now(), probes);
    return { status: "STALE_LOCK_REAPED", pid: reaped.pid };
  }
  if (current.state !== "running") throw new Error(`refusing to signal controller in state ${current.state}`);
  if (current.evidence !== "process-command") throw new Error("refusing to signal controller without process-command ownership evidence");
  const pid = current.pid;
  probes.kill(current.pid, "SIGTERM");
  await waitFor(() => {
    current = lockStatus(manifest, Date.now(), probes);
    if (current.state === "stale-lock") {
      reapStaleLock(manifest, Date.now(), probes);
      return true;
    }
    return current.state === "stopped";
  }, 150_000, "controller shutdown");
  return { status: "STOPPED", pid };
}

export async function waitArmed(
  manifest,
  timeoutMs = 180_000,
  logOffset = 0,
  expectedRun = null,
  probes = { kill: process.kill.bind(process), command: processCommand },
) {
  const logFile = path.join(manifest.paths.runtime, "controller.ndjson");
  let run = expectedRun;
  return waitFor(() => {
    const ownership = lockStatus(manifest, Date.now(), probes);
    if (ownership.state !== "running") throw new Error(`controller stopped before arming: ${ownership.state}`);
    const runtime = readRuntimeState(manifest);
    if (!runtime?.controllerRunId || !runtime?.armAttemptId) return null;
    run ??= { runId: runtime.controllerRunId, armAttemptId: runtime.armAttemptId };
    if (!run.runId || !run.armAttemptId) return null;
    if (runtime.controllerRunId !== run.runId) throw new Error("controller run changed while waiting for armed state");
    // Recovery legitimately creates a newer arming attempt inside the same controller process.
    // Follow that forward attempt within the original timeout instead of tearing down a controller
    // which may already have self-recovered and armed. A different run remains fatal.
    if (runtime.armAttemptId !== run.armAttemptId) run = { ...run, armAttemptId: runtime.armAttemptId };
    let bytes;
    try { bytes = fs.readFileSync(logFile); } catch { return null; }
    if (bytes.length < logOffset) throw new Error("controller log truncated after start");
    const text = bytes.subarray(logOffset).toString("utf8");
    const rows = text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const armed = rows.findLast((row) => ["armed", "rearmed-after-codex-restart"].includes(row.event)
      && row.runId === run.runId && row.armAttemptId === run.armAttemptId);
    const ambiguous = rows.findLast((row) => row.event === "ambiguous");
    const degraded = rows.findLast((row) => row.event === "degraded");
    if (ambiguous && (!armed || ambiguous.ts > armed.ts)) return null;
    if (degraded && (!armed || degraded.ts > armed.ts)) return null;
    if (!armed) return null;
    const finalOwnership = lockStatus(manifest, Date.now(), probes);
    if (finalOwnership.state !== "running") throw new Error(`controller stopped while arming: ${finalOwnership.state}`);
    const wake = runtimeHealth(manifest, finalOwnership);
    if (wake.status !== "ARMED") return null;
    return armed;
  }, timeoutMs, "controller armed state");
}

async function uninstall(manifest, confirmed) {
  if (!confirmed) throw new CliUsageError("uninstall requires --confirm-dedicated-home");
  await stop(manifest);
  if (sha256(manifest.paths.launcher) !== manifest.hashes.launcherSha256) throw new Error("refusing to remove modified launcher");
  const root = path.resolve(manifest.paths.installRoot);
  if (root !== installRoot || root === path.parse(root).root || path.basename(root) !== "codex-kijito-hive") throw new Error("refusing unsafe install root");
  fs.unlinkSync(manifest.paths.launcher);
  fs.rmSync(root, { recursive: true, force: false });
  return { status: "UNINSTALLED", removed: [root, manifest.paths.launcher], recoverable: false };
}

async function main() {
  const [command = "status", ...rest] = process.argv.slice(2);
  let manifest;
  try { manifest = loadManifest(); }
  catch (error) {
    if (command !== "doctor") throw error;
    const result = doctorFailure(null, error, command);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  if (wakeCoreImportError) throw wakeCoreImportError;
  let result;
  if (command === "doctor") result = doctor(manifest);
  else if (command === "status") {
    const controller = lockStatus(manifest);
    const wake = runtimeHealth(manifest, controller);
    result = { status: controller, wake: { status: wake.status, reasons: wake.reasons } };
  }
  else if (command === "run") {
    // Fail integrity problems (notably corrupt locks) through the same structured verdict path as
    // every detached verb before handing stdio to the foreground controller.
    lockStatus(manifest);
    const child = spawn(process.execPath, controllerArgs(manifest), { cwd: manifest.paths.workspace, env: safeEnv(), stdio: "inherit" });
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    const [code, signal] = await new Promise((resolve) => child.once("exit", (c, s) => resolve([c, s])));
    if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1;
    return;
  } else if (command === "start") result = await start(manifest);
  else if (command === "stop") result = await stop(manifest);
  else if (command === "smoke") {
    try {
      const started = await start(manifest);
      result = { status: "ARMED", started, armed: started.armed };
    } finally { await stop(manifest); }
  } else if (command === "wait-armed") result = { status: "ARMED", event: await waitArmed(manifest) };
  else if (command === "uninstall") result = await uninstall(manifest, rest.includes("--confirm-dedicated-home"));
  else throw new CliUsageError(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result?.status === "RED" || result?.wake?.status === "RED") process.exitCode = 1;
}

function isDirectExecution(argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

if (isDirectExecution()) {
  main().catch((error) => {
    const command = process.argv[2] ?? "status";
    const result = doctorFailure(null, error, command);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
  });
}

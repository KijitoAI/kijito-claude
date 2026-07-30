#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConsumerLockFile } from "../_shared/wake-core.mjs";

// This installer used to live at <root>/release/install.mjs, so its source root was one level up.
// Folded into kijito-claude it sits AT the provider root (providers/codex/), so `here` IS the source
// root. The shared wake core is a sibling of that root, at providers/_shared/wake-core.mjs.
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRootDefault = here;

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArgs(argv) {
  const values = {};
  // Boolean flags first: the loop below consumes strict `--key value` pairs and would reject a bare
  // flag as an invalid argument.
  const flags = new Set(["skills-only", "upgrade"]);
  const bare = new Set();
  argv = argv.filter((token) => {
    const isFlag = token.startsWith("--") && flags.has(token.slice(2));
    if (isFlag) bare.add(token.slice(2));
    return !isFlag;
  });
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${key ?? ""}`);
    values[key.slice(2)] = argv[index + 1];
  }
  const home = os.homedir();
  const expand = (value) => path.resolve(value.replace(/^~(?=\/|$)/, home));
  const eventsFile = expand(values["events-file"] ?? path.join(home, ".cache", "kijito-inbox-monitor", "events.codex.ndjson"));
  const lockFile = defaultConsumerLockFile(eventsFile, "codex");
  if (values["lock-file"] !== undefined && expand(values["lock-file"]) !== lockFile) {
    throw new Error("--lock-file must equal the deterministic Codex lock under the event-stream directory");
  }
  return {
    sourceRoot: expand(values["source-root"] ?? sourceRootDefault),
    installRoot: expand(values["install-root"] ?? path.join(home, ".local", "share", "codex-kijito-hive")),
    launcher: expand(values.launcher ?? path.join(home, ".local", "bin", "codex-kijito-hive")),
    authSource: expand(values["auth-source"] ?? path.join(home, ".codex", "auth.json")),
    ordinaryConfig: expand(values["ordinary-config"] ?? path.join(home, ".codex", "config.toml")),
    tokenFile: expand(values["token-file"] ?? path.join(home, ".claude", ".kijito_api_token")),
    eventsFile,
    lockFile,
    codexBin: expand(values["codex-bin"] ?? path.join(home, ".local", "bin", "codex")),
    nodeBin: expand(values["node-bin"] ?? process.execPath),
    skillsRoot: expand(values["skills-root"] ?? path.join(home, ".codex", "skills")),
    skillsOnly: bare.has("skills-only"),
    upgrade: bare.has("upgrade"),
  };
}

// Deploy the provider's skills to the Codex skills directory.
//
// SEPARATE FROM THE INSTALL ROOT, AND IDEMPOTENT, on purpose. The install root is created once and
// atomically, and refuses to overwrite — correct for a supervised runtime holding a copied auth
// token. Skills are the opposite kind of thing: versioned prose that is meant to be UPDATED in
// place, so they are written over.
//
// This exists because the fold found codex's two skills living ONLY at ~/.codex/skills with no
// upstream in any repository. Version-controlling them without also shipping a way to deploy them
// would have left the rescue half-done: the next machine would have the repo and still no skills.
function installSkills({ sourceRoot, skillsRoot }) {
  const source = path.join(sourceRoot, "skills");
  const deployed = [];
  let names = [];
  try { names = fs.readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
  catch (error) { if (error.code === "ENOENT") return deployed; throw error; }
  for (const name of names) {
    const skillFile = path.join(source, name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const target = path.join(skillsRoot, name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), fs.readFileSync(skillFile), { mode: 0o644 });
    const files = ["SKILL.md"];
    // The agents/ sidecar carries the Codex-surface interface metadata (display name, default
    // prompt). A skill deployed without it loses its presentation, so it travels with the skill.
    const sidecar = path.join(source, name, "agents", "openai.yaml");
    if (fs.existsSync(sidecar)) {
      fs.mkdirSync(path.join(target, "agents"), { recursive: true });
      fs.writeFileSync(path.join(target, "agents", "openai.yaml"), fs.readFileSync(sidecar), { mode: 0o644 });
      files.push("agents/openai.yaml");
    }
    deployed.push({ skill: name, target, files });
  }
  return deployed;
}

function requireAbsoluteDistinct(options) {
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string" && !path.isAbsolute(value)) throw new Error(`${key} must be absolute`);
  }
  if (options.installRoot === path.parse(options.installRoot).root) throw new Error("install root cannot be a filesystem root");
  if (options.launcher === options.installRoot || options.launcher.startsWith(`${options.installRoot}${path.sep}`)) {
    throw new Error("launcher must be outside the install root");
  }
}

function requirePrivateRegular(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`${label} must be one regular file`);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be private and user-owned`);
}

function requirePrivateDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private user-owned real directory`);
  }
}

function requireOwnedNonWritableDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) {
    throw new Error(`${label} must be a user-owned, non-group/other-writable real directory`);
  }
}

function ensureLockDirectory(eventsFile, lockFile) {
  requireOwnedNonWritableDirectory(path.dirname(eventsFile), "monitor event directory");
  requirePrivateRegular(eventsFile, "monitor event stream");
  const expected = defaultConsumerLockFile(eventsFile, "codex");
  if (lockFile !== expected) throw new Error("consumer lock is not the deterministic Codex lock under the event-stream directory");
  const lockDir = path.dirname(lockFile);
  try { fs.mkdirSync(lockDir, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  requirePrivateDirectory(lockDir, "package-owned consumer-lock directory");
}

function requireExecutable(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) throw new Error(`${label} must be an executable regular file`);
}

function optionalHash(file) {
  try { return sha256(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function writePrivate(file, content, mode = 0o600) {
  fs.writeFileSync(file, content, { flag: "wx", mode });
  fs.chmodSync(file, mode);
}

function configText() {
  return [
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
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function launcherText({ installRoot, nodeBin }) {
  return [
    "#!/bin/sh",
    "set -eu",
    'if [ -n "${CODEX_KIJITO_NODE:-}" ] && [ -x "${CODEX_KIJITO_NODE}" ]; then',
    '  kijito_node="${CODEX_KIJITO_NODE}"',
    `elif [ -x ${shellQuote(nodeBin)} ]; then`,
    `  kijito_node=${shellQuote(nodeBin)}`,
    'elif command -v node >/dev/null 2>&1 && node -e \'process.exit(Number(process.versions.node.split(".")[0]) < 20)\'; then',
    '  kijito_node="$(command -v node)"',
    "else",
    '  echo "codex-kijito-hive: Node.js 20+ is required; set CODEX_KIJITO_NODE to a healthy executable" >&2',
    "  exit 1",
    "fi",
    `exec "$kijito_node" ${shellQuote(path.join(installRoot, "cli.mjs"))} "$@"`,
    "",
  ].join("\n");
}

function copyPrivate(source, target, mode = 0o600) {
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, mode);
}

function install(options, { skipSkills = false } = {}) {
  requireAbsoluteDistinct(options);
  ensureLockDirectory(options.eventsFile, options.lockFile);
  const sourceManifestFile = path.join(options.sourceRoot, "release-manifest.json");
  const controllerSource = path.join(options.sourceRoot, "controller.mjs");
  const cliSource = path.join(options.sourceRoot, "cli.mjs");
  const controllerTests = path.join(options.sourceRoot, "test", "codex-hive-watch.test.mjs");
  const wakeCoreSource = path.join(options.sourceRoot, "..", "_shared", "wake-core.mjs");
  const release = JSON.parse(fs.readFileSync(sourceManifestFile, "utf8"));
  if (release.schema !== 1 || release.product !== "codex-kijito-hive") throw new Error("invalid source release manifest");
  if (sha256(controllerSource) !== release.artifacts.controllerSha256) throw new Error("controller differs from gated hash");
  if (sha256(controllerTests) !== release.artifacts.controllerTestsSha256) throw new Error("controller tests differ from gated hash");
  // The wake core is executable code inside a hash-gated install, so it is gated exactly like the
  // controller it was extracted from. Splitting a gated file into gated + ungated halves would have
  // left parseEventLine and fixedWakeText -- the event validator and the injection fence -- editable
  // while the integrity hashes still passed.
  if (sha256(wakeCoreSource) !== release.artifacts.wakeCoreSha256) throw new Error("wake core differs from gated hash");
  // The parity plan is RECORDED, not gated. It used to be hash-gated here, from a path OUTSIDE the
  // installable directory (`<sourceRoot>/../codex-kijito-parity-plan.md`), which meant every install
  // threw the moment the source root moved -- and gated an install on a prose document. The hash is
  // still carried forward into the installed manifest below for provenance.
  requirePrivateRegular(options.authSource, "auth source");
  requirePrivateRegular(options.tokenFile, "token file");
  const codexResolvedAtInstall = fs.realpathSync(options.codexBin);
  options.nodeBin = fs.realpathSync(options.nodeBin);
  requireExecutable(codexResolvedAtInstall, "Codex binary target");
  requireExecutable(options.nodeBin, "Node binary");
  const ordinaryBefore = {
    configSha256: optionalHash(options.ordinaryConfig),
    authSha256: sha256(options.authSource),
  };
  for (const target of [options.installRoot, options.launcher]) {
    try { fs.lstatSync(target); throw new Error(`refusing to overwrite existing target: ${target}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  fs.mkdirSync(path.dirname(options.installRoot), { recursive: true });
  fs.mkdirSync(path.dirname(options.launcher), { recursive: true });
  options.installRoot = path.join(fs.realpathSync(path.dirname(options.installRoot)), path.basename(options.installRoot));
  options.launcher = path.join(fs.realpathSync(path.dirname(options.launcher)), path.basename(options.launcher));
  const tempRoot = fs.mkdtempSync(path.join(path.dirname(options.installRoot), `.codex-kijito-hive.install.${randomBytes(4).toString("hex")}.`));
  fs.chmodSync(tempRoot, 0o700);
  let committed = false;
  try {
    // The installed layout MIRRORS the repo's relative layout for the two code files, so the
    // controller's `import "../_shared/wake-core.mjs"` specifier is identical in both trees -- no
    // rewriting at install time, no duplicated copy of the shared module, no symlink.
    for (const name of ["codex-home", "workspace", "runtime", "codex", "_shared"]) fs.mkdirSync(path.join(tempRoot, name), { mode: 0o700 });
    copyPrivate(options.authSource, path.join(tempRoot, "codex-home", "auth.json"));
    writePrivate(path.join(tempRoot, "codex-home", "config.toml"), configText());
    copyPrivate(controllerSource, path.join(tempRoot, "codex", "controller.mjs"));
    copyPrivate(wakeCoreSource, path.join(tempRoot, "_shared", "wake-core.mjs"));
    copyPrivate(cliSource, path.join(tempRoot, "cli.mjs"));
    const installed = {
      schema: 1,
      product: release.product,
      version: release.version,
      installId: randomBytes(16).toString("hex"),
      installedAt: new Date().toISOString(),
      paths: {
        installRoot: options.installRoot,
        launcher: options.launcher,
        codexHome: path.join(options.installRoot, "codex-home"),
        workspace: path.join(options.installRoot, "workspace"),
        runtime: path.join(options.installRoot, "runtime"),
        tokenFile: options.tokenFile,
        eventsFile: options.eventsFile,
        lockFile: options.lockFile,
        codexBin: options.codexBin,
        codexResolvedAtInstall,
        nodeBin: options.nodeBin,
        ordinaryConfig: options.ordinaryConfig,
        ordinaryAuth: options.authSource
      },
      hashes: {
        controllerSha256: sha256(path.join(tempRoot, "codex", "controller.mjs")),
        wakeCoreSha256: sha256(path.join(tempRoot, "_shared", "wake-core.mjs")),
        cliSha256: sha256(path.join(tempRoot, "cli.mjs")),
        configSha256: sha256(path.join(tempRoot, "codex-home", "config.toml")),
        authSha256: sha256(path.join(tempRoot, "codex-home", "auth.json")),
        planSha256: release.artifacts.planSha256,
        controllerTestsSha256: release.artifacts.controllerTestsSha256,
        ordinaryConfigBeforeSha256: ordinaryBefore.configSha256,
        ordinaryAuthBeforeSha256: ordinaryBefore.authSha256
      },
      invariants: {
        hooks: false,
        launchAgent: false,
        ordinaryCodexStateMutation: false,
        currentUserThreadMutation: false,
        messageBodyInjection: false
      }
    };
    writePrivate(path.join(tempRoot, "installed-manifest.json"), `${JSON.stringify(installed, null, 2)}\n`);
    fs.renameSync(tempRoot, options.installRoot);
    const launcher = launcherText(options);
    writePrivate(options.launcher, launcher, 0o700);
    installed.hashes.launcherSha256 = sha256(options.launcher);
    fs.writeFileSync(path.join(options.installRoot, "installed-manifest.json"), `${JSON.stringify(installed, null, 2)}\n`, { mode: 0o600 });
    committed = true;
    const ordinaryAfter = {
      configSha256: optionalHash(options.ordinaryConfig),
      authSha256: sha256(options.authSource),
    };
    if (JSON.stringify(ordinaryAfter) !== JSON.stringify(ordinaryBefore)) throw new Error("ordinary Codex state changed during installation");
    const skills = skipSkills ? [] : installSkills(options);
    return { status: "INSTALLED", installRoot: options.installRoot, launcher: options.launcher, ordinaryStateUnchanged: true, hashes: installed.hashes, skills };
  } finally {
    if (!committed) {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }
}

function runLauncher(launcher, args, nodeBin, timeout = 210_000) {
  const result = spawnSync(launcher, args, {
    encoding: "utf8",
    timeout,
    env: { ...process.env, CODEX_KIJITO_NODE: nodeBin },
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch {}
  return { ...result, json };
}

function acquireUpgradeLock(file) {
  requirePrivateDirectory(path.dirname(file), "upgrade-lock directory");
  const token = randomBytes(16).toString("hex");
  const create = () => {
    const fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, token, persona: "codex", operation: "upgrade" })}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  };
  try { create(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    requirePrivateRegular(file, "upgrade lock");
    const staleText = fs.readFileSync(file, "utf8");
    const stale = JSON.parse(staleText);
    if (!Number.isSafeInteger(stale.pid) || stale.pid <= 1 || typeof stale.token !== "string" || stale.persona !== "codex") {
      throw new Error("refusing invalid upgrade lock");
    }
    try { process.kill(stale.pid, 0); throw new Error(`upgrade already running as pid ${stale.pid}`); }
    catch (probeError) {
      if (probeError.code !== "ESRCH") throw probeError;
    }
    const quarantine = `${file}.stale.${process.pid}.${Date.now()}`;
    fs.renameSync(file, quarantine);
    if (fs.readFileSync(quarantine, "utf8") !== staleText) {
      try { if (!fs.existsSync(file)) fs.renameSync(quarantine, file); } catch {}
      throw new Error("upgrade lock changed before quarantine");
    }
    fs.unlinkSync(quarantine);
    create();
  }
  return { file, token };
}

function releaseUpgradeLock(lock) {
  try {
    const current = JSON.parse(fs.readFileSync(lock.file, "utf8"));
    if (current.token === lock.token) fs.unlinkSync(lock.file);
  } catch {}
}

function reapDeadConsumerLock(file) {
  requirePrivateRegular(file, "stale consumer lock");
  const staleText = fs.readFileSync(file, "utf8");
  const stale = JSON.parse(staleText);
  if (!Number.isSafeInteger(stale.pid) || stale.pid <= 1 || typeof stale.token !== "string" || stale.persona !== "codex") {
    throw new Error("refusing invalid stale consumer lock");
  }
  try { process.kill(stale.pid, 0); throw new Error(`consumer lock pid ${stale.pid} is still alive`); }
  catch (probeError) { if (probeError.code !== "ESRCH") throw probeError; }
  const quarantine = `${file}.stale.${process.pid}.${Date.now()}`;
  fs.renameSync(file, quarantine);
  try {
    requirePrivateRegular(quarantine, "quarantined stale consumer lock");
    if (fs.readFileSync(quarantine, "utf8") !== staleText) throw new Error("consumer lock changed before quarantine");
    fs.unlinkSync(quarantine);
  } catch (error) {
    try { if (!fs.existsSync(file)) fs.renameSync(quarantine, file); } catch {}
    throw error;
  }
}

function copyUpgradeRuntime(oldRuntime, newRuntime, eventsFile) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(oldRuntime, "state.json"), "utf8"));
    if (state.schema !== 1 || state.persona !== "codex") throw new Error("old runtime state identity mismatch");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = {
      schema: 1,
      persona: "codex",
      threadId: null,
      eventFile: null,
      offset: 0,
      partialBase64: "",
      lastMailId: 0,
      recentKeys: [],
      lastAttempt: null,
      ambiguous: null,
      degraded: null,
      recovery: null,
    };
    try {
      const stat = fs.lstatSync(eventsFile);
      state.eventFile = { dev: stat.dev, ino: stat.ino };
      state.offset = 0;
    } catch (eventError) {
      if (eventError.code !== "ENOENT") throw eventError;
    }
  }
  state.controllerPid = null;
  state.controllerRunId = null;
  state.armAttemptId = null;
  state.armedRunId = null;
  state.armedAttemptId = null;
  state.armedAt = null;
  state.lockTokenHash = null;
  state.heartbeatAt = null;
  state.clientStatus = "stopped";
  state.stoppedAt = new Date().toISOString();
  state.needsReconcile = true;
  fs.writeFileSync(path.join(newRuntime, "state.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  const oldLog = path.join(oldRuntime, "controller.ndjson");
  if (fs.existsSync(oldLog)) fs.copyFileSync(oldLog, path.join(newRuntime, "controller.ndjson"));
  return state;
}

function upgrade(options) {
  requireAbsoluteDistinct(options);
  ensureLockDirectory(options.eventsFile, options.lockFile);
  options.installRoot = path.join(fs.realpathSync(path.dirname(options.installRoot)), path.basename(options.installRoot));
  options.launcher = path.join(fs.realpathSync(path.dirname(options.launcher)), path.basename(options.launcher));
  requirePrivateRegular(path.join(options.installRoot, "installed-manifest.json"), "existing installed manifest");
  requireExecutable(options.launcher, "existing launcher");
  options.nodeBin = fs.realpathSync(options.nodeBin);
  const oldManifest = JSON.parse(fs.readFileSync(path.join(options.installRoot, "installed-manifest.json"), "utf8"));
  if (oldManifest.schema !== 1 || oldManifest.product !== "codex-kijito-hive" || oldManifest.paths.installRoot !== options.installRoot) {
    throw new Error("existing installation identity mismatch");
  }
  if (oldManifest.paths.eventsFile !== options.eventsFile) throw new Error("upgrade cannot change the event stream");
  const upgradeLock = `${options.lockFile}.upgrade`;
  const heldUpgradeLock = acquireUpgradeLock(upgradeLock);

  const suffix = `${Date.now()}.${randomBytes(4).toString("hex")}`;
  const stagedRoot = `${options.installRoot}.stage.${suffix}`;
  const stagedLauncher = `${options.launcher}.stage.${suffix}`;
  const backupRoot = `${options.installRoot}.rollback.${suffix}`;
  const backupLauncher = `${options.launcher}.rollback.${suffix}`;
  const failedRoot = `${options.installRoot}.failed.${suffix}`;
  let wasRunning = false;
  let oldStopped = false;
  let backupRootReady = false;
  let backupLauncherReady = false;
  let newRootReady = false;
  let newStartAttempted = false;
  try {
    const status = runLauncher(options.launcher, ["status"], options.nodeBin, 30_000);
    if (!status.json?.status?.state) throw new Error(`cannot determine existing controller status: ${status.stderr || status.stdout}`);
    wasRunning = status.json.status.state === "running";
    if (!["running", "stopped", "stale-lock"].includes(status.json.status.state)) {
      throw new Error(`refusing upgrade from controller state ${status.json.status.state}`);
    }
    if (status.json.status.state === "stale-lock") {
      const oldLockFile = oldManifest.paths.lockFile ?? path.join(oldManifest.paths.runtime, "consumer.lock");
      reapDeadConsumerLock(oldLockFile);
    }

    const stagedOptions = { ...options, installRoot: stagedRoot, launcher: stagedLauncher, upgrade: false };
    install(stagedOptions, { skipSkills: true });

    const stopped = runLauncher(options.launcher, ["stop"], options.nodeBin, 170_000);
    if (stopped.status !== 0) throw new Error(`existing controller did not stop cleanly: ${stopped.stderr || stopped.stdout}`);
    oldStopped = true;

    const preserved = copyUpgradeRuntime(oldManifest.paths.runtime, path.join(stagedRoot, "runtime"), options.eventsFile);
    const nextManifestFile = path.join(stagedRoot, "installed-manifest.json");
    const nextManifest = JSON.parse(fs.readFileSync(nextManifestFile, "utf8"));
    nextManifest.paths = {
      ...nextManifest.paths,
      installRoot: options.installRoot,
      launcher: options.launcher,
      codexHome: path.join(options.installRoot, "codex-home"),
      workspace: path.join(options.installRoot, "workspace"),
      runtime: path.join(options.installRoot, "runtime"),
      lockFile: options.lockFile,
    };
    nextManifest.upgradedAt = new Date().toISOString();
    nextManifest.upgradedFrom = { installId: oldManifest.installId ?? null, version: oldManifest.version ?? null };
    const finalLauncher = launcherText({ installRoot: options.installRoot, nodeBin: options.nodeBin });
    fs.unlinkSync(stagedLauncher);
    fs.renameSync(options.installRoot, backupRoot);
    backupRootReady = true;
    fs.renameSync(options.launcher, backupLauncher);
    backupLauncherReady = true;
    fs.renameSync(stagedRoot, options.installRoot);
    newRootReady = true;
    writePrivate(options.launcher, finalLauncher, 0o700);
    nextManifest.hashes.launcherSha256 = sha256(options.launcher);
    fs.writeFileSync(path.join(options.installRoot, "installed-manifest.json"), `${JSON.stringify(nextManifest, null, 2)}\n`, { mode: 0o600 });
    let armed = null;
    if (wasRunning) {
      newStartAttempted = true;
      const started = runLauncher(options.launcher, ["start"], options.nodeBin);
      if (started.status !== 0 || started.json?.status !== "ARMED") throw new Error(`upgraded controller failed to arm: ${started.stderr || started.stdout}`);
      armed = started.json;
    }
    const health = runLauncher(options.launcher, ["doctor"], options.nodeBin, 30_000);
    const expected = wasRunning ? "ARMED" : "INACTIVE";
    if (health.status !== 0 || health.json?.status !== expected) throw new Error(`upgraded doctor is not ${expected}: ${health.stderr || health.stdout}`);
    const skills = installSkills(options);
    return {
      status: wasRunning ? "UPGRADED_ARMED" : "UPGRADED_INACTIVE",
      installRoot: options.installRoot,
      launcher: options.launcher,
      rollbackRoot: backupRoot,
      rollbackLauncher: backupLauncher,
      preserved: { threadId: preserved.threadId, lastMailId: preserved.lastMailId, offset: preserved.offset },
      armed,
      doctor: health.json,
      skills,
      recoverable: true,
    };
  } catch (error) {
    if (backupRootReady) {
      if (newStartAttempted) {
        const stopped = runLauncher(options.launcher, ["stop"], options.nodeBin, 170_000);
        if (stopped.status !== 0) {
          error.message += `; rollback held because upgraded controller ownership could not be stopped safely: ${stopped.stderr || stopped.stdout}`;
          throw error;
        }
      }
      if (newRootReady && fs.existsSync(options.installRoot)) fs.renameSync(options.installRoot, failedRoot);
      if (backupLauncherReady && fs.existsSync(options.launcher)) fs.unlinkSync(options.launcher);
      fs.renameSync(backupRoot, options.installRoot);
      backupRootReady = false;
      if (backupLauncherReady) {
        fs.renameSync(backupLauncher, options.launcher);
        backupLauncherReady = false;
      }
      if (wasRunning) {
        const restored = runLauncher(options.launcher, ["start"], options.nodeBin);
        if (restored.status !== 0) error.message += `; rollback controller failed to re-arm: ${restored.stderr || restored.stdout}`;
        else error.message += "; previous installation restored and re-armed";
      }
    } else if (oldStopped && wasRunning) {
      const restored = runLauncher(options.launcher, ["start"], options.nodeBin);
      if (restored.status !== 0) error.message += `; pre-swap controller failed to re-arm: ${restored.stderr || restored.stdout}`;
    }
    throw error;
  } finally {
    try { fs.rmSync(stagedRoot, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(stagedLauncher); } catch {}
    releaseUpgradeLock(heldUpgradeLock);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.skillsOnly && options.upgrade) throw new Error("--skills-only and --upgrade are mutually exclusive");
  // --skills-only updates the skills on a machine whose install root already exists, which a full
  // install deliberately refuses to touch.
  const result = options.skillsOnly
    ? { status: "SKILLS_INSTALLED", skillsRoot: options.skillsRoot, skills: installSkills(options) }
    : options.upgrade ? upgrade(options) : install(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

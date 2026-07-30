import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertArmedHealth, lockStatus, reapStaleLock, runtimeHealth, stop, waitArmed } from "../cli.mjs";
import { parseArgs as parseInstallArgs, upgrade as upgradeDirect } from "../install.mjs";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(packageRoot, "..", "..");
const installer = path.join(packageRoot, "install.mjs");
const mockAppServer = fileURLToPath(new URL("./mock-app-server.mjs", import.meta.url));

function run(args, expected = 0) {
  const direct = !args[0].endsWith(".mjs");
  const result = direct
    ? spawnSync(args[0], args.slice(1), { encoding: "utf8" })
    : spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

function waitForFile(file, pattern, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = fs.readFileSync(file, "utf8");
      if (pattern.test(text)) return text;
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  throw new Error(`timed out waiting for ${pattern} in ${file}`);
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition timed out");
}

function runAsync(file, args) {
  const child = spawn(file, args, { encoding: "utf8", env: { ...process.env, CODEX_KIJITO_NODE: process.execPath } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr })));
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-package."));
  fs.chmodSync(root, 0o700);
  const ordinary = path.join(root, "ordinary");
  const monitor = path.join(root, "monitor");
  fs.mkdirSync(ordinary, { mode: 0o700 });
  fs.mkdirSync(monitor, { mode: 0o755 });
  fs.chmodSync(monitor, 0o755);
  const auth = path.join(ordinary, "auth.json");
  const config = path.join(ordinary, "config.toml");
  const token = path.join(root, "token");
  const events = path.join(monitor, "events.codex.ndjson");
  fs.writeFileSync(auth, '{"auth":"fixture"}\n', { mode: 0o600 });
  fs.writeFileSync(config, 'model = "fixture"\n', { mode: 0o600 });
  fs.writeFileSync(token, `kjt_${"x".repeat(32)}\n`, { mode: 0o600 });
  fs.writeFileSync(events, "", { mode: 0o600 });
  const realBin = path.join(root, "codex-real");
  const bin = path.join(root, "codex");
  const startDelayFile = path.join(root, "delay-app-server-start");
  const startupFailEnableFile = path.join(root, "fail-first-startup-turn");
  const startupFailMarker = path.join(root, "failed-first-startup-turn");
  const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
  fs.writeFileSync(realBin, `#!/bin/sh\nif [ -f ${quote(startDelayFile)} ]; then sleep 2; fi\nif [ -f ${quote(startupFailEnableFile)} ]; then exec env PROBE_FAIL_TURN_START_AT=1 PROBE_FAIL_TURN_START_MARKER=${quote(startupFailMarker)} ${quote(process.execPath)} ${quote(mockAppServer)} "$@"; fi\nexec ${quote(process.execPath)} ${quote(mockAppServer)} "$@"\n`, { mode: 0o700 });
  fs.chmodSync(realBin, 0o700);
  fs.symlinkSync(realBin, bin);
  return {
    root,
    installRoot: path.join(root, "share", "codex-kijito-hive"),
    launcher: path.join(root, "bin", "codex-kijito-hive"),
    // Hermetic skills target. Without this the installer's default (~/.codex/skills) would make
    // the test suite deploy into the developer's real Codex install.
    skillsRoot: path.join(root, "codex-skills"),
    auth, config, token, events, bin, realBin, startDelayFile, startupFailEnableFile, startupFailMarker,
  };
}

function cleanupFixture(f) {
  if (fs.existsSync(f.launcher)) {
    const stopped = spawnSync(f.launcher, ["stop"], {
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, CODEX_KIJITO_NODE: process.execPath },
    });
    if (stopped.status !== 0) {
      const manifestFile = path.join(f.installRoot, "installed-manifest.json");
      if (fs.existsSync(manifestFile)) {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        const lockFile = manifest.paths.lockFile ?? path.join(manifest.paths.runtime, "consumer.lock");
        if (fs.existsSync(lockFile)) {
          const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
          const probe = spawnSync("/bin/ps", ["-ww", "-p", String(lock.pid), "-o", "command="], { encoding: "utf8" });
          const expectedController = path.join(f.installRoot, "codex", "controller.mjs");
          if (probe.status === 0 && probe.stdout.includes(expectedController)) process.kill(lock.pid, "SIGTERM");
          const deadline = Date.now() + 10_000;
          while (fs.existsSync(lockFile) && Date.now() < deadline) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
          }
          if (fs.existsSync(lockFile)) throw new Error(`fixture controller did not stop safely: ${stopped.stderr || stopped.stdout}`);
        }
      }
    }
  }
  fs.rmSync(f.root, { recursive: true, force: true });
}

function upgradeArgs(f) {
  return [...installArgs(f), "--upgrade"];
}

function installArgs(f) {
  return [installer,
    "--source-root", packageRoot,
    "--install-root", f.installRoot,
    "--launcher", f.launcher,
    "--auth-source", f.auth,
    "--ordinary-config", f.config,
    "--token-file", f.token,
    "--events-file", f.events,
    "--codex-bin", f.bin,
    "--node-bin", process.execPath,
    "--skills-root", f.skillsRoot,
  ];
}

function installLegacyFlatFixture(f, { stopFailsAfterExit = false, statusFails = false, stopSucceedsWithoutExit = false } = {}) {
  const runtime = path.join(f.installRoot, "runtime");
  const codexHome = path.join(f.installRoot, "codex-home");
  const workspace = path.join(f.installRoot, "workspace");
  const legacyLock = path.join(runtime, "consumer.lock");
  const stopFailureFile = path.join(f.root, "legacy-stop-fails-after-exit");
  const statusFailureFile = path.join(f.root, "legacy-status-fails");
  const statusFailureEnableFile = path.join(f.root, "legacy-status-fails-after-stop");
  const falseStopSuccessFile = path.join(f.root, "legacy-stop-succeeds-without-exit");
  const startCountFile = path.join(f.root, "legacy-start-count");
  for (const dir of [f.installRoot, runtime, codexHome, workspace, path.dirname(f.launcher)]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
  fs.copyFileSync(f.auth, path.join(codexHome, "auth.json"));
  fs.chmodSync(path.join(codexHome, "auth.json"), 0o600);
  fs.writeFileSync(path.join(codexHome, "config.toml"), "hooks = false\n", { mode: 0o600 });
  fs.writeFileSync(path.join(f.installRoot, "controller.mjs"), "// legacy flat controller fixture\n", { mode: 0o600 });
  const eventStat = fs.statSync(f.events);
  fs.writeFileSync(path.join(runtime, "state.json"), `${JSON.stringify({
    schema: 1,
    persona: "codex",
    threadId: "mock-thread-1",
    eventFile: { dev: eventStat.dev, ino: eventStat.ino },
    offset: 0,
    partialBase64: "",
    lastMailId: 7000,
    recentKeys: [],
    pendingItems: [],
    lastAttempt: null,
    ambiguous: null,
    degraded: null,
    recovery: null,
  }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(legacyLock, `${JSON.stringify({ pid: process.pid, token: "legacy-token", persona: "codex" })}\n`, { mode: 0o600 });
  if (stopFailsAfterExit) fs.writeFileSync(stopFailureFile, "fail\n", { mode: 0o600 });
  if (statusFails) fs.writeFileSync(statusFailureEnableFile, "fail\n", { mode: 0o600 });
  if (stopSucceedsWithoutExit) fs.writeFileSync(falseStopSuccessFile, "fail\n", { mode: 0o600 });
  const quote = (value) => JSON.stringify(value);
  const legacyCli = path.join(f.installRoot, "legacy-cli.mjs");
  const legacyCliText = `import fs from "node:fs";\nconst lock=${quote(legacyLock)};\nconst stopFailure=${quote(stopFailureFile)};\nconst statusFailure=${quote(statusFailureFile)};\nconst statusFailureEnable=${quote(statusFailureEnableFile)};\nconst falseStopSuccess=${quote(falseStopSuccessFile)};\nconst starts=${quote(startCountFile)};\nconst command=process.argv[2] ?? "status";\nif (command === "status") { if (fs.existsSync(statusFailure)) { console.error("intentional legacy status failure"); process.exitCode=1; } else console.log(JSON.stringify({status:{state:fs.existsSync(lock)?"running":"stopped"}})); }\nelse if (command === "stop") { if (!fs.existsSync(falseStopSuccess)) { try { fs.unlinkSync(lock); } catch (e) { if (e.code !== "ENOENT") throw e; } } if (fs.existsSync(statusFailureEnable)) fs.writeFileSync(statusFailure,"fail\\n",{mode:0o600}); if (fs.existsSync(stopFailure)) { console.error("intentional legacy stop timeout after exit"); process.exitCode=1; } else console.log(JSON.stringify({status:"STOPPED"})); }\nelse if (command === "start") { fs.writeFileSync(lock, JSON.stringify({pid:process.pid,token:"legacy-rearmed",persona:"codex"})+"\\n", {mode:0o600}); fs.appendFileSync(starts,"start\\n"); console.log(JSON.stringify({status:"ARMED"})); }\nelse { console.error("unknown legacy command"); process.exitCode=1; }\n`;
  fs.writeFileSync(legacyCli, legacyCliText, { mode: 0o600 });
  const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
  const launcher = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(legacyCli)} "$@"\n`;
  fs.writeFileSync(f.launcher, launcher, { mode: 0o700 });
  fs.chmodSync(f.launcher, 0o700);
  const manifest = {
    schema: 1,
    product: "codex-kijito-hive",
    version: "0.legacy",
    installId: "legacy-install",
    paths: {
      installRoot: path.join(fs.realpathSync(path.dirname(f.installRoot)), path.basename(f.installRoot)),
      launcher: path.join(fs.realpathSync(path.dirname(f.launcher)), path.basename(f.launcher)),
      codexHome,
      workspace,
      runtime,
      tokenFile: f.token,
      eventsFile: f.events,
      codexBin: fs.realpathSync(f.bin),
      nodeBin: fs.realpathSync(process.execPath),
      ordinaryConfig: f.config,
      ordinaryAuth: f.auth,
    },
    hashes: {},
  };
  fs.writeFileSync(path.join(f.installRoot, "installed-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { legacyLock, stopFailureFile, statusFailureFile, statusFailureEnableFile, falseStopSuccessFile, startCountFile, manifest };
}

test("release install, doctor, duplicate refusal, and manifest-bound uninstall", () => {
  const f = fixture();
  try {
    fs.chmodSync(path.dirname(f.events), 0o775);
    const writableMonitor = run(installArgs(f), 1);
    assert.match(writableMonitor.stderr, /monitor event directory must be a user-owned, non-group\/other-writable real directory/);
    fs.chmodSync(path.dirname(f.events), 0o755);
    const customLock = run([...installArgs(f), "--lock-file", path.join(f.root, "custom.lock")], 1);
    assert.match(customLock.stderr, /deterministic Codex lock/);
    const ordinaryBefore = fs.readFileSync(f.config, "utf8");
    const authBefore = fs.readFileSync(f.auth, "utf8");
    const installed = JSON.parse(run(installArgs(f)).stdout);
    assert.equal(installed.status, "INSTALLED");
    assert.equal(installed.ordinaryStateUnchanged, true);
    // A full install also deploys the skills, into the fixture's own root -- never the real one.
    assert.deepEqual(installed.skills.map((s) => s.skill).sort(), ["kijito-qa-memory", "kijito-start"]);
    assert.ok(installed.skills.every((s) => s.target.startsWith(f.skillsRoot)));
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.equal(manifest.paths.codexBin, path.resolve(f.bin));
    assert.equal(manifest.paths.codexResolvedAtInstall, fs.realpathSync(f.bin));
    const doctor = JSON.parse(run([f.launcher, "doctor"]).stdout);
    assert.equal(doctor.status, "INACTIVE");
    assert.equal(doctor.wake.status, "INACTIVE");
    assert.equal(doctor.hooksDisabled, true);
    assert.equal(doctor.launchAgentInstalled, false);
    assert.equal(doctor.workspaceEmpty, true);
    assert.equal(doctor.ordinaryStateMatchesInstallSnapshot, true);
    const linkedCli = path.join(f.root, "linked-cli.mjs");
    fs.symlinkSync(path.join(f.installRoot, "cli.mjs"), linkedCli);
    const linkedResult = run([process.execPath, linkedCli, "doctor"]);
    assert.notEqual(linkedResult.stdout.trim(), "", "a symlinked direct CLI path must execute rather than silently no-op");
    const linkedDoctor = JSON.parse(linkedResult.stdout);
    assert.equal(linkedDoctor.status, "INACTIVE", "a symlinked direct CLI path must execute rather than silently no-op");
    const vanishedArgv = path.join(f.root, "vanished-cli-entry.mjs");
    const importedCli = pathToFileURL(path.join(f.installRoot, "cli.mjs")).href;
    const importOnly = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `process.argv[1] = ${JSON.stringify(vanishedArgv)}; await import(${JSON.stringify(importedCli)});`,
    ], { encoding: "utf8" });
    assert.equal(importOnly.status, 0, importOnly.stderr || "a vanished argv entry must not break library import");
    const unknown = JSON.parse(run([f.launcher, "not-a-command"], 1).stdout);
    assert.equal(unknown.status, "RED", "usage failures keep a structured RED envelope");
    assert.equal(unknown.command, "not-a-command");
    assert.equal(unknown.failure.category, "usage", "unknown commands use the typed usage category");
    assert.match(unknown.failure.stack, /unknown command: not-a-command/);
    assert.equal(unknown.wake.status, "UNKNOWN", "a usage error must not claim the wake path itself is red");
    const nextRealBin = path.join(f.root, "codex-real-next");
    fs.copyFileSync(f.realBin, nextRealBin);
    fs.chmodSync(nextRealBin, 0o700);
    fs.unlinkSync(f.bin);
    fs.symlinkSync(nextRealBin, f.bin);
    const retargetedDoctor = JSON.parse(run([f.launcher, "doctor"]).stdout);
    assert.equal(retargetedDoctor.status, "INACTIVE");
    assert.equal(retargetedDoctor.codexBin, path.resolve(f.bin));
    assert.equal(retargetedDoctor.codexResolvedNow, fs.realpathSync(nextRealBin));
    assert.equal(retargetedDoctor.codexTargetChanged, true, "the stable Codex symlink follows a vendor upgrade without wedging start");
    manifest.paths.lockFile = path.join(manifest.paths.runtime, "consumer.lock");
    fs.writeFileSync(path.join(f.installRoot, "installed-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const unscopedManifest = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(unscopedManifest.status, "RED", "doctor integrity exceptions keep a structured RED envelope");
    assert.match(unscopedManifest.reasons.join(" "), /consumer lock is not the deterministic lock/);
    manifest.paths.lockFile = path.join(path.dirname(f.events), ".codex-hive-locks", "consumer.codex.lock");
    fs.writeFileSync(path.join(f.installRoot, "installed-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(path.dirname(manifest.paths.lockFile), 0o775);
    const writableLockParent = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(writableLockParent.status, "RED");
    assert.match(writableLockParent.reasons.join(" "), /package-owned consumer-lock directory is not a private user-owned real directory/);
    fs.chmodSync(path.dirname(manifest.paths.lockFile), 0o700);
    fs.writeFileSync(manifest.paths.lockFile, "{broken\n", { mode: 0o600 });
    const corruptLock = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(corruptLock.status, "RED");
    assert.equal(corruptLock.command, "doctor");
    assert.equal(corruptLock.wake.status, "RED");
    assert.equal(corruptLock.failure.category, "integrity");
    assert.match(corruptLock.failure.stack, /SyntaxError/);
    assert.match(corruptLock.reasons.join(" "), /integrity failure/);
    for (const args of [
      ["status"], ["start"], ["stop"], ["wait-armed"], ["smoke"], ["run"],
      ["uninstall", "--confirm-dedicated-home"],
    ]) {
      const verdict = JSON.parse(run([f.launcher, ...args], 1).stdout);
      assert.equal(verdict.status, "RED", `${args[0]} returns a structured fail-closed verdict`);
      assert.equal(verdict.wake.status, "RED");
      assert.equal(verdict.command, args[0]);
      assert.equal(verdict.failure.category, "integrity");
      assert.match(verdict.failure.stack, /SyntaxError/);
      assert.match(verdict.reasons.join(" "), /integrity failure/);
    }
    fs.unlinkSync(manifest.paths.lockFile);
    const manifestFile = path.join(f.installRoot, "installed-manifest.json");
    const validManifestText = fs.readFileSync(manifestFile, "utf8");
    fs.writeFileSync(manifestFile, "{broken\n", { mode: 0o600 });
    const corruptManifest = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(corruptManifest.status, "RED");
    assert.equal(corruptManifest.command, "doctor");
    assert.equal(corruptManifest.wake.status, "RED");
    assert.equal(corruptManifest.failure.category, "integrity");
    assert.match(corruptManifest.failure.stack, /SyntaxError/);
    assert.match(corruptManifest.reasons.join(" "), /integrity failure/);
    for (const hostileText of ["invalid argument", "unknown command", "requires --confirm"]) {
      fs.writeFileSync(manifestFile, `${hostileText}\n`, { mode: 0o600 });
      try {
        const adversarialManifest = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
        assert.equal(adversarialManifest.status, "RED");
        assert.equal(adversarialManifest.command, "doctor");
        assert.equal(adversarialManifest.wake.status, "RED", "untrusted parse text must not downgrade wake integrity");
        assert.equal(adversarialManifest.failure.category, "integrity");
        assert.match(adversarialManifest.failure.stack, /SyntaxError/);
      } finally {
        fs.writeFileSync(manifestFile, validManifestText, { mode: 0o600 });
      }
    }
    fs.renameSync(f.events, `${f.events}.held`);
    const missingEvents = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(missingEvents.status, "RED");
    assert.match(missingEvents.reasons.join(" "), /monitor event stream is unavailable/);
    fs.renameSync(`${f.events}.held`, f.events);
    fs.appendFileSync(f.config, "# external ordinary-state change\n");
    const ordinaryDrift = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(ordinaryDrift.status, "RED");
    assert.match(ordinaryDrift.reasons.join(" "), /ordinary Codex state differs/);
    fs.writeFileSync(f.config, ordinaryBefore, { mode: 0o600 });
    fs.writeFileSync(path.join(f.installRoot, "runtime", "state.json"), `${JSON.stringify({
      schema: 1,
      persona: "codex",
      ambiguous: { at: "2026-07-29T20:14:31.692Z", reason: "acceptance unknown", batch: [] },
    })}\n`, { mode: 0o600 });
    const unhealthy = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(unhealthy.status, "RED");
    assert.match(unhealthy.wake.reasons.join(" "), /delivery ambiguous since 2026-07-29T20:14:31\.692Z/);
    for (const [patch, pattern] of [
      [{ degraded: { at: "2026-07-29T20:15:00Z", reason: "child exited" } }, /controller degraded/],
      [{ recovery: { at: "2026-07-29T20:16:00Z", attempt: 1 } }, /recovery incomplete/],
      [{ pendingSince: "2020-01-01T00:00:00Z" }, /relevant event pending/],
    ]) {
      fs.writeFileSync(path.join(f.installRoot, "runtime", "state.json"), `${JSON.stringify({ schema: 1, persona: "codex", ...patch })}\n`, { mode: 0o600 });
      const fault = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
      assert.equal(fault.status, "RED");
      assert.match(fault.wake.reasons.join(" "), pattern);
    }
    fs.writeFileSync(path.join(f.installRoot, "runtime", "state.json"), "{broken\n", { mode: 0o600 });
    const corrupt = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(corrupt.status, "RED");
    assert.match(corrupt.wake.reasons.join(" "), /runtime state is unreadable/);
    fs.unlinkSync(path.join(f.installRoot, "runtime", "state.json"));
    run(installArgs(f), 1);
    assert.equal(fs.readFileSync(f.config, "utf8"), ordinaryBefore);
    assert.equal(fs.readFileSync(f.auth, "utf8"), authBefore);
    run([f.launcher, "uninstall"], 1);
    const removed = JSON.parse(run([f.launcher, "uninstall", "--confirm-dedicated-home"]).stdout);
    assert.equal(removed.status, "UNINSTALLED");
    assert.equal(fs.existsSync(f.installRoot), false);
    assert.equal(fs.existsSync(f.launcher), false);
    assert.equal(fs.readFileSync(f.config, "utf8"), ordinaryBefore);
    assert.equal(fs.readFileSync(f.auth, "utf8"), authBefore);
  } finally { cleanupFixture(f); }
});

test("upgrade preserves thread and cursor, replays window events, and keeps one event-directory/persona lock", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    const beforeManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const eventStat = fs.statSync(f.events);
    const preserved = {
      schema: 1,
      persona: "codex",
      threadId: "mock-thread-1",
      eventFile: { dev: eventStat.dev, ino: eventStat.ino },
      offset: 0,
      partialBase64: "",
      lastMailId: 0,
      recentKeys: [],
      lastAttempt: null,
      ambiguous: null,
    };
    fs.writeFileSync(path.join(f.installRoot, "runtime", "state.json"), `${JSON.stringify(preserved)}\n`, { mode: 0o600 });
    fs.appendFileSync(f.events, `${JSON.stringify({ source: "kijito-inbox", persona: "codex", event: "new", id: 7701 })}\n`);
    fs.writeFileSync(beforeManifest.paths.lockFile, `${JSON.stringify({ pid: 999999, token: "stale-consumer", persona: "codex" })}\n`, { mode: 0o600 });
    fs.writeFileSync(`${beforeManifest.paths.lockFile}.upgrade`, `${JSON.stringify({ pid: 999999, token: "stale-upgrade", persona: "codex", operation: "upgrade" })}\n`, { mode: 0o600 });

    fs.chmodSync(path.dirname(beforeManifest.paths.lockFile), 0o775);
    const writableUpgradeParent = run(upgradeArgs(f), 1);
    assert.match(writableUpgradeParent.stderr, /package-owned consumer-lock directory must be a private user-owned real directory/);
    fs.chmodSync(path.dirname(beforeManifest.paths.lockFile), 0o700);

    const upgraded = JSON.parse(run(upgradeArgs(f)).stdout);
    assert.equal(upgraded.status, "UPGRADED_INACTIVE");
    assert.equal(upgraded.preserved.threadId, "mock-thread-1");
    assert.equal(upgraded.preserved.offset, 0, "upgrade must not jump an inherited cursor to EOF");
    assert.equal(fs.existsSync(upgraded.rollbackRoot), true, "rollback copy remains recoverable");
    const afterManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.notEqual(afterManifest.installId, beforeManifest.installId);
    assert.equal(afterManifest.paths.lockFile, path.join(path.dirname(f.events), ".codex-hive-locks", "consumer.codex.lock"));

    const started = JSON.parse(run([f.launcher, "start"]).stdout);
    assert.equal(started.status, "ARMED");
    const log = waitForFile(path.join(f.installRoot, "runtime", "controller.ndjson"), /"id":7701/);
    const afterState = JSON.parse(fs.readFileSync(path.join(f.installRoot, "runtime", "state.json"), "utf8"));
    assert.equal(afterState.threadId, "mock-thread-1");
    assert.equal(afterState.lastMailId, 7701);
    assert.equal(fs.existsSync(afterManifest.paths.lockFile), true);
    assert.equal(fs.existsSync(path.join(f.installRoot, "runtime", "consumer.lock")), false);
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("successful upgrades retain only the two newest private rollback roots and launchers", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    const reported = [];
    for (let pass = 0; pass < 4; pass += 1) {
      const upgraded = JSON.parse(run(upgradeArgs(f)).stdout);
      assert.equal(upgraded.status, "UPGRADED_INACTIVE");
      reported.push(upgraded.rollbackRoot);
    }
    const roots = fs.readdirSync(path.dirname(f.installRoot))
      .filter((name) => name.startsWith(`${path.basename(f.installRoot)}.rollback.`));
    const launchers = fs.readdirSync(path.dirname(f.launcher))
      .filter((name) => name.startsWith(`${path.basename(f.launcher)}.rollback.`));
    assert.equal(roots.length, 2);
    assert.equal(launchers.length, 2);
    assert.equal(fs.existsSync(reported[0]), false);
    assert.equal(fs.existsSync(reported[1]), false);
    assert.equal(fs.existsSync(reported[2]), true);
    assert.equal(fs.existsSync(reported[3]), true);
  } finally { cleanupFixture(f); }
});

test("retention failure is reported after a verified upgrade without rolling it back", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    const before = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const options = parseInstallArgs(upgradeArgs(f).slice(1));
    const retentionError = Object.assign(new Error("intentional retention EPERM"), { code: "EPERM" });
    const upgraded = upgradeDirect(options, { prune: () => { throw retentionError; } });
    assert.equal(upgraded.status, "UPGRADED_INACTIVE");
    assert.deepEqual(upgraded.retentionWarnings.map(({ code }) => code), ["EPERM"]);
    assert.equal(fs.existsSync(`${options.lockFile}.upgrade`), false, "retention failure still releases upgrade ownership");
    const after = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.notEqual(after.installId, before.installId, "the verified replacement remains installed");
    assert.equal(fs.existsSync(upgraded.rollbackRoot), true, "the previous installation remains recoverable");
  } finally { cleanupFixture(f); }
});

test("upgrade preflight rejection leaves the running old consumer and lock token untouched", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    run([f.launcher, "start"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const beforeText = fs.readFileSync(manifest.paths.lockFile, "utf8");
    const before = JSON.parse(beforeText);
    fs.chmodSync(path.dirname(manifest.paths.lockFile), 0o775);
    const rejected = run(upgradeArgs(f), 1);
    assert.match(rejected.stderr, /package-owned consumer-lock directory must be a private user-owned real directory/);
    fs.chmodSync(path.dirname(manifest.paths.lockFile), 0o700);
    assert.equal(fs.readFileSync(manifest.paths.lockFile, "utf8"), beforeText);
    process.kill(before.pid, 0);
    const status = JSON.parse(run([f.launcher, "status"]).stdout);
    assert.equal(status.wake.status, "ARMED");
    assert.equal(JSON.parse(fs.readFileSync(manifest.paths.lockFile, "utf8")).token, before.token);
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("upgrade refuses configured-path drift before stopping the running consumer", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    run([f.launcher, "start"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const beforeLock = fs.readFileSync(manifest.paths.lockFile, "utf8");
    const alternateToken = path.join(f.root, "alternate-token");
    fs.writeFileSync(alternateToken, `kjt_${"y".repeat(32)}\n`, { mode: 0o600 });
    const rejected = run([...upgradeArgs(f), "--token-file", alternateToken], 1);
    assert.match(rejected.stderr, /upgrade cannot silently change Kijito token file/);
    assert.equal(fs.readFileSync(manifest.paths.lockFile, "utf8"), beforeLock);
    assert.equal(JSON.parse(run([f.launcher, "status"]).stdout).wake.status, "ARMED");
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("upgrade of an armed controller returns armed on the same dedicated thread", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    const first = JSON.parse(run([f.launcher, "start"]).stdout);
    assert.equal(first.status, "ARMED");
    const before = JSON.parse(fs.readFileSync(path.join(f.installRoot, "runtime", "state.json"), "utf8"));
    const upgraded = JSON.parse(run(upgradeArgs(f)).stdout);
    assert.equal(upgraded.status, "UPGRADED_ARMED");
    assert.equal(upgraded.doctor.status, "ARMED");
    const after = JSON.parse(fs.readFileSync(path.join(f.installRoot, "runtime", "state.json"), "utf8"));
    assert.equal(after.threadId, before.threadId);
    assert.equal(after.ambiguous, null);
    assert.equal(after.degraded, null);
    assert.equal(after.recovery, null);
    assert.equal(after.clientStatus, "idle");
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("running legacy flat ownership upgrades to canonical ARMED state on the same thread", () => {
  const f = fixture();
  try {
    const legacy = installLegacyFlatFixture(f);
    const upgraded = JSON.parse(run(upgradeArgs(f)).stdout);
    assert.equal(upgraded.status, "UPGRADED_ARMED");
    assert.equal(upgraded.preserved.threadId, "mock-thread-1");
    assert.equal(upgraded.preserved.lastMailId, 7000);
    assert.equal(upgraded.doctor.status, "ARMED");
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const state = JSON.parse(fs.readFileSync(path.join(manifest.paths.runtime, "state.json"), "utf8"));
    assert.equal(state.threadId, "mock-thread-1");
    assert.equal(state.clientStatus, "idle");
    assert.equal(fs.existsSync(legacy.legacyLock), false);
    assert.equal(fs.existsSync(manifest.paths.lockFile), true);
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("failed legacy stop that already exited is re-armed before upgrade returns failure", () => {
  const f = fixture();
  try {
    const legacy = installLegacyFlatFixture(f, { stopFailsAfterExit: true });
    const failed = run(upgradeArgs(f), 1);
    assert.match(failed.stderr, /existing controller did not stop cleanly/);
    assert.match(failed.stderr, /pre-swap controller re-armed after failed stop/);
    assert.equal(fs.existsSync(legacy.legacyLock), true);
    assert.equal(fs.readFileSync(legacy.startCountFile, "utf8").trim().split("\n").length, 1);
    assert.equal(JSON.parse(run([f.launcher, "status"]).stdout).status.state, "running");
    fs.unlinkSync(legacy.stopFailureFile);
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("failed legacy stop with unverifiable ownership refuses a blind re-arm", () => {
  const f = fixture();
  try {
    const legacy = installLegacyFlatFixture(f, { stopFailsAfterExit: true, statusFails: true });
    const failed = run(upgradeArgs(f), 1);
    assert.match(failed.stderr, /existing controller did not stop cleanly/);
    assert.match(failed.stderr, /ownership is unverifiable, refusing blind re-arm/);
    assert.equal(fs.existsSync(legacy.startCountFile), false);
    assert.equal(fs.existsSync(legacy.legacyLock), false);
    fs.unlinkSync(legacy.statusFailureFile);
    fs.unlinkSync(legacy.stopFailureFile);
  } finally { cleanupFixture(f); }
});

test("legacy stop success must prove ownership stopped before canonical swap", () => {
  const f = fixture();
  try {
    const legacy = installLegacyFlatFixture(f, { stopSucceedsWithoutExit: true });
    const failed = run(upgradeArgs(f), 1);
    assert.match(failed.stderr, /did not prove stopped ownership after stop/);
    assert.equal(fs.existsSync(legacy.legacyLock), true);
    assert.equal(fs.existsSync(legacy.startCountFile), false);
    assert.equal(JSON.parse(run([f.launcher, "status"]).stdout).status.state, "running");
    fs.unlinkSync(legacy.falseStopSuccessFile);
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("hard-crash restart and SIGUSR1 stay RED until the current arming attempt completes", async () => {
  const f = fixture();
  try {
    run(installArgs(f));
    run([f.launcher, "start"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const stateFile = path.join(manifest.paths.runtime, "state.json");
    const beforeCrash = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const oldLock = JSON.parse(fs.readFileSync(manifest.paths.lockFile, "utf8"));
    process.kill(oldLock.pid, "SIGKILL");
    await waitUntil(() => {
      try { process.kill(oldLock.pid, 0); return false; }
      catch (error) { return error.code === "ESRCH"; }
    }, 10_000);

    fs.writeFileSync(f.startDelayFile, "delay\n");
    const restarting = runAsync(f.launcher, ["start"]);
    await waitUntil(() => {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        return state.controllerRunId !== beforeCrash.controllerRunId && state.clientStatus === "starting" && state.armedAt === null;
      } catch { return false; }
    }, 10_000);
    fs.unlinkSync(f.startDelayFile);
    const crashWindow = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(crashWindow.status, "RED");
    assert.match(crashWindow.wake.reasons.join(" "), /has not recorded armed state|different controller run|different arming attempt|app-server is starting/);
    const restarted = await restarting;
    assert.equal(restarted.code, 0, restarted.stderr || restarted.stdout);
    assert.equal(JSON.parse(restarted.stdout).status, "ARMED");

    const afterCrash = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const liveLock = JSON.parse(fs.readFileSync(manifest.paths.lockFile, "utf8"));
    fs.writeFileSync(f.startDelayFile, "delay\n");
    process.kill(liveLock.pid, "SIGUSR1");
    await waitUntil(() => {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return state.armAttemptId !== afterCrash.armAttemptId && state.clientStatus === "starting" && state.armedAt === null;
    }, 10_000);
    fs.unlinkSync(f.startDelayFile);
    const restartWindow = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(restartWindow.status, "RED");
    assert.match(restartWindow.wake.reasons.join(" "), /has not recorded armed state|different arming attempt|app-server is starting/);
    await waitUntil(() => {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return state.clientStatus === "idle" && state.armedAt && state.armedAttemptId === state.armAttemptId;
    }, 10_000);
    assert.equal(JSON.parse(run([f.launcher, "doctor"]).stdout).status, "ARMED");
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("start follows forward recovery attempts and returns ARMED instead of stopping the recovered controller", async () => {
  const f = fixture();
  try {
    run(installArgs(f));
    fs.writeFileSync(f.startupFailEnableFile, "fail once\n", { mode: 0o600 });
    const started = await runAsync(f.launcher, ["start"]);
    assert.equal(started.code, 0, started.stderr || started.stdout);
    const result = JSON.parse(started.stdout);
    assert.equal(result.status, "ARMED");
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const state = JSON.parse(fs.readFileSync(path.join(manifest.paths.runtime, "state.json"), "utf8"));
    assert.equal(state.ambiguous, null);
    assert.equal(state.degraded, null);
    assert.equal(state.clientStatus, "idle");
    assert.equal(state.armedRunId, state.controllerRunId);
    assert.equal(state.armedAttemptId, state.armAttemptId);
    const rows = fs.readFileSync(path.join(manifest.paths.runtime, "controller.ndjson"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    const attempts = rows.filter((row) => row.event === "arming");
    assert.ok(attempts.length >= 2, "startup failure must advance into a recovery arming attempt");
    assert.equal(new Set(attempts.map((row) => row.runId)).size, 1, "recovery stays within the same controller run");
    assert.ok(new Set(attempts.map((row) => row.armAttemptId)).size >= 2);
    const status = JSON.parse(run([f.launcher, "status"]).stdout);
    assert.equal(status.wake.status, "ARMED", "the launcher must leave the self-recovered controller running");
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("failed upgraded bytes roll back and re-arm the previous installation", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    run([f.launcher, "start"]);
    const beforeManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const badProviders = path.join(f.root, "bad-providers");
    const badCodex = path.join(badProviders, "codex");
    fs.cpSync(packageRoot, badCodex, { recursive: true });
    fs.mkdirSync(path.join(badProviders, "_shared"), { recursive: true });
    fs.copyFileSync(path.join(packageRoot, "..", "_shared", "wake-core.mjs"), path.join(badProviders, "_shared", "wake-core.mjs"));
    const badController = path.join(badCodex, "controller.mjs");
    fs.appendFileSync(badController, "\nthrow new Error(\"intentional upgraded-controller startup failure\");\n");
    const badReleaseFile = path.join(badCodex, "release-manifest.json");
    const badRelease = JSON.parse(fs.readFileSync(badReleaseFile, "utf8"));
    badRelease.artifacts.controllerSha256 = createHash("sha256").update(fs.readFileSync(badController)).digest("hex");
    fs.writeFileSync(badReleaseFile, `${JSON.stringify(badRelease, null, 2)}\n`);

    const failed = run([...upgradeArgs(f), "--source-root", badCodex], 1);
    assert.match(failed.stderr, /intentional upgraded-controller startup failure|failed to arm/);
    assert.match(failed.stderr, /previous installation restored and re-armed/);
    const restoredManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.equal(restoredManifest.installId, beforeManifest.installId);
    const restored = JSON.parse(run([f.launcher, "status"]).stdout);
    assert.equal(restored.wake.status, "ARMED");
    run([f.launcher, "stop"]);
  } finally { cleanupFixture(f); }
});

test("rollback reports when the restored old controller cannot re-arm", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    run([f.launcher, "start"]);
    const beforeManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    fs.appendFileSync(path.join(f.installRoot, "codex", "controller.mjs"), "\nthrow new Error(\"intentional restored-controller failure\");\n");

    const badProviders = path.join(f.root, "bad-providers-rearm");
    const badCodex = path.join(badProviders, "codex");
    fs.cpSync(packageRoot, badCodex, { recursive: true });
    fs.mkdirSync(path.join(badProviders, "_shared"), { recursive: true });
    fs.copyFileSync(path.join(packageRoot, "..", "_shared", "wake-core.mjs"), path.join(badProviders, "_shared", "wake-core.mjs"));
    const badController = path.join(badCodex, "controller.mjs");
    fs.appendFileSync(badController, "\nthrow new Error(\"intentional upgraded-controller failure before rollback\");\n");
    const badReleaseFile = path.join(badCodex, "release-manifest.json");
    const badRelease = JSON.parse(fs.readFileSync(badReleaseFile, "utf8"));
    badRelease.artifacts.controllerSha256 = createHash("sha256").update(fs.readFileSync(badController)).digest("hex");
    fs.writeFileSync(badReleaseFile, `${JSON.stringify(badRelease, null, 2)}\n`);

    const failed = run([...upgradeArgs(f), "--source-root", badCodex], 1);
    assert.match(failed.stderr, /rollback controller failed to re-arm/);
    const restoredManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.equal(restoredManifest.installId, beforeManifest.installId);
  } finally { cleanupFixture(f); }
});

test("upgrade holds rollback bytes when new ownership cannot be stopped safely", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    run([f.launcher, "start"]);
    const beforeManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const badProviders = path.join(f.root, "bad-providers-stop-refusal");
    const badCodex = path.join(badProviders, "codex");
    fs.cpSync(packageRoot, badCodex, { recursive: true });
    fs.mkdirSync(path.join(badProviders, "_shared"), { recursive: true });
    fs.copyFileSync(path.join(packageRoot, "..", "_shared", "wake-core.mjs"), path.join(badProviders, "_shared", "wake-core.mjs"));
    const badCli = path.join(badCodex, "cli.mjs");
    const originalCli = fs.readFileSync(badCli, "utf8");
    const mutatedCli = originalCli
      .replace('else if (command === "start") result = await start(manifest);', 'else if (command === "start") { await start(manifest); throw new Error("intentional post-arm start failure"); }')
      .replace('else if (command === "stop") result = await stop(manifest);', 'else if (command === "stop") throw new Error("intentional candidate stop refusal");');
    assert.notEqual(mutatedCli, originalCli);
    fs.writeFileSync(badCli, mutatedCli, { mode: 0o600 });

    const failed = run([...upgradeArgs(f), "--source-root", badCodex], 1);
    assert.match(failed.stderr, /rollback held because upgraded controller ownership could not be stopped safely/);
    const currentManifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.notEqual(currentManifest.installId, beforeManifest.installId, "new ownership remains current when rollback is refused");
    const backups = fs.readdirSync(path.dirname(f.installRoot)).filter((name) => name.startsWith(`${path.basename(f.installRoot)}.rollback.`));
    assert.equal(backups.length, 1, "old installation remains recoverable in exactly one rollback root");
  } finally { cleanupFixture(f); }
});

test("two install roots sharing one event-directory/persona stream cannot double-arm", () => {
  const first = fixture();
  const second = fixture();
  second.events = first.events;
  try {
    run(installArgs(first));
    run(installArgs(second));
    const firstManifest = JSON.parse(fs.readFileSync(path.join(first.installRoot, "installed-manifest.json"), "utf8"));
    fs.writeFileSync(firstManifest.paths.lockFile, `${JSON.stringify({ pid: 999999, token: "stale-before-start", persona: "codex" })}\n`, { mode: 0o600 });
    const firstStarted = JSON.parse(run([first.launcher, "start"]).stdout);
    assert.equal(firstStarted.status, "ARMED");
    const refused = run([second.launcher, "start"], 1);
    const refusedVerdict = JSON.parse(refused.stdout);
    assert.equal(refusedVerdict.status, "RED");
    assert.match(refusedVerdict.reasons.join(" "), /EEXIST|cannot start from state (?:running|pid-mismatch)|controller ownership/);
    const firstStatus = JSON.parse(run([first.launcher, "status"]).stdout);
    assert.equal(firstStatus.wake.status, "ARMED");
    const secondManifest = JSON.parse(fs.readFileSync(path.join(second.installRoot, "installed-manifest.json"), "utf8"));
    assert.equal(firstManifest.paths.lockFile, secondManifest.paths.lockFile);
    run([first.launcher, "stop"]);
  } finally {
    cleanupFixture(first);
    cleanupFixture(second);
  }
});

test("skills deploy with their agents sidecar, idempotently, without an install root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-skills."));
  fs.chmodSync(root, 0o700);
  try {
    const skillsRoot = path.join(root, "skills");
    const first = JSON.parse(run([installer, "--skills-only", "--skills-root", skillsRoot]).stdout);
    assert.equal(first.status, "SKILLS_INSTALLED");
    assert.deepEqual(first.skills.map((s) => s.skill).sort(), ["kijito-qa-memory", "kijito-start"]);
    for (const s of first.skills) {
      assert.ok(fs.existsSync(path.join(s.target, "SKILL.md")), `${s.skill} SKILL.md`);
      // The sidecar carries the Codex-surface interface metadata; a skill without it loses its
      // display name and default prompt, so it must travel with the skill.
      assert.ok(fs.existsSync(path.join(s.target, "agents", "openai.yaml")), `${s.skill} sidecar`);
    }
    // Skills are versioned prose meant to be UPDATED in place, unlike the install root, which
    // refuses to overwrite. A second run must succeed rather than throw.
    fs.appendFileSync(path.join(skillsRoot, "kijito-start", "SKILL.md"), "\nlocal edit\n");
    const second = JSON.parse(run([installer, "--skills-only", "--skills-root", skillsRoot]).stdout);
    assert.equal(second.skills.length, 2);
    const repoSkill = fs.readFileSync(path.join(packageRoot, "skills", "kijito-start", "SKILL.md"), "utf8");
    assert.equal(fs.readFileSync(path.join(skillsRoot, "kijito-start", "SKILL.md"), "utf8"), repoSkill);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("doctor and uninstall fail closed on installed-byte tampering", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    // Every executable file the install places must fail doctor closed when edited. The controller
    // and the shared wake core are BOTH checked: the wake core holds parseEventLine (the event
    // validator) and fixedWakeText (the prompt-injection fence), so an ungated copy of it would be
    // the most valuable thing in the install to tamper with.
    for (const target of [path.join(f.installRoot, "codex", "controller.mjs"),
                          path.join(f.installRoot, "_shared", "wake-core.mjs")]) {
      const bytes = fs.readFileSync(target);
      fs.appendFileSync(target, "\n// tamper\n");
      run([f.launcher, "doctor"], 1);
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      run([f.launcher, "doctor"]);
    }
    const wakeCore = path.join(f.installRoot, "_shared", "wake-core.mjs");
    const wakeCoreBytes = fs.readFileSync(wakeCore);
    const fallbackCore = path.join(path.dirname(f.installRoot), "_shared", "wake-core.mjs");
    fs.mkdirSync(path.dirname(fallbackCore), { mode: 0o700 });
    fs.writeFileSync(fallbackCore, wakeCoreBytes, { mode: 0o600 });
    fs.unlinkSync(wakeCore);
    const missingCoreRun = spawnSync(f.launcher, ["status"], { encoding: "utf8" });
    assert.equal(missingCoreRun.status, 1, "installed CLI must not fall back to an out-of-root shared core");
    assert.notEqual(missingCoreRun.stdout.trim(), "", "missing shared core must reach the structured RED handler");
    const missingCore = JSON.parse(missingCoreRun.stdout);
    assert.equal(missingCore.status, "RED");
    assert.equal(missingCore.command, "status");
    assert.equal(missingCore.failure.category, "integrity");
    assert.match(missingCore.failure.stack, /ERR_MODULE_NOT_FOUND|Cannot find module/);
    assert.match(missingCore.reasons.join(" "), /integrity failure/);
    fs.writeFileSync(wakeCore, wakeCoreBytes, { mode: 0o600 });
    run([f.launcher, "doctor"]);
    const launcherBytes = fs.readFileSync(f.launcher);
    fs.appendFileSync(f.launcher, "\n# tamper\n");
    run([f.launcher, "uninstall", "--confirm-dedicated-home"], 1);
    fs.writeFileSync(f.launcher, launcherBytes, { mode: 0o700 });
    run([f.launcher, "uninstall", "--confirm-dedicated-home"]);
    assert.equal(fs.existsSync(f.installRoot), false);
    assert.equal(fs.existsSync(f.launcher), false);
  } finally { cleanupFixture(f); }
});

test("drift gate compares installed Codex controller, shared core, and CLI bytes", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    const claudeInstall = path.join(f.root, "claude-install");
    fs.mkdirSync(path.join(claudeInstall, "skills"), { recursive: true });
    for (const entry of fs.readdirSync(path.join(repoRoot, "providers", "claude", "scripts"))) {
      if (entry.endsWith(".sh")) fs.copyFileSync(path.join(repoRoot, "providers", "claude", "scripts", entry), path.join(claudeInstall, entry));
    }
    for (const entry of fs.readdirSync(path.join(repoRoot, "providers", "claude", "skills"))) {
      const source = path.join(repoRoot, "providers", "claude", "skills", entry, "SKILL.md");
      if (!fs.existsSync(source)) continue;
      fs.mkdirSync(path.join(claudeInstall, "skills", entry), { recursive: true });
      fs.copyFileSync(source, path.join(claudeInstall, "skills", entry, "SKILL.md"));
    }
    const env = {
      ...process.env,
      KIJITO_INSTALL_DIR: claudeInstall,
      KIJITO_CODEX_SKILLS_DIR: f.skillsRoot,
      KIJITO_CODEX_INSTALL_ROOT: f.installRoot,
    };
    const drift = spawnSync("bash", [path.join(repoRoot, "tests", "drift_test.sh")], { encoding: "utf8", env });
    assert.equal(drift.status, 0, drift.stdout + drift.stderr);
    assert.match(drift.stdout, /codex wake runtime/);
    assert.match(drift.stdout, /ok\s+controller\.mjs/);
    assert.match(drift.stdout, /ok\s+wake-core\.mjs/);
    assert.match(drift.stdout, /ok\s+cli\.mjs/);
    const driftSource = fs.readFileSync(path.join(repoRoot, "tests", "drift_test.sh"), "utf8");
    assert.match(driftSource, /\.\/install\.sh --provider codex --upgrade/);

    const installedController = path.join(f.installRoot, "codex", "controller.mjs");
    fs.appendFileSync(installedController, "\n// drift mutation\n");
    const mutated = spawnSync("bash", [path.join(repoRoot, "tests", "drift_test.sh")], { encoding: "utf8", env });
    assert.equal(mutated.status, 1);
    assert.match(mutated.stdout, /DRIFT\s+controller\.mjs/);
  } finally { cleanupFixture(f); }
});

test("smoke behavior accepts only its own armed generation and leaves the controller inactive", () => {
  const f = fixture();
  try {
    run(installArgs(f));
    const smoke = JSON.parse(run([f.launcher, "smoke"]).stdout);
    assert.equal(smoke.status, "ARMED");
    assert.equal(smoke.started.status, "ARMED");
    assert.equal(smoke.armed.runId, smoke.started.armed.runId);
    assert.equal(smoke.armed.armAttemptId, smoke.started.armed.armAttemptId);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    const after = JSON.parse(run([f.launcher, "status"]).stdout);
    assert.equal(after.status.state, "stopped");
    assert.equal(after.wake.status, "INACTIVE");
    assert.equal(fs.existsSync(manifest.paths.lockFile), false);
  } finally { cleanupFixture(f); }
});

test("startup skill requires strong ARMED predicates and rejects clean INACTIVE as arm evidence", () => {
  const skill = fs.readFileSync(path.join(packageRoot, "skills", "kijito-start", "SKILL.md"), "utf8");
  assert.match(skill, /top-level doctor `ARMED`, doctor `wake\.status` exactly\s+`ARMED`/);
  assert.match(skill, /`INACTIVE` for a cleanly stopped controller and `RED` for a fault; neither\s+is arm evidence/);
  assert.doesNotMatch(skill, /Require `running` plus doctor `GREEN`/);
});

test("sandbox EPERM process probe falls back to a fresh private heartbeat", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-heartbeat."));
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const now = Date.parse("2026-07-30T03:45:00Z");
  try {
    fs.writeFileSync(path.join(runtime, "consumer.lock"), `${JSON.stringify({ pid: 4242, token: "token", persona: "codex" })}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(runtime, "state.json"), `${JSON.stringify({
      schema: 1,
      persona: "codex",
      controllerPid: 4242,
      lockTokenHash: createHash("sha256").update("token").digest("hex"),
      heartbeatAt: new Date(now - 1_000).toISOString(),
    })}\n`, { mode: 0o600 });
    const eperm = Object.assign(new Error("not permitted"), { code: "EPERM" });
    const status = lockStatus({ paths: { runtime } }, now, {
      kill: () => { throw eperm; },
      command: () => ({ command: "", error: "EPERM" }),
    });
    assert.equal(status.state, "running");
    assert.equal(status.evidence, "private-heartbeat");
    const wrongLock = lockStatus({ paths: { runtime } }, now, {
      kill: () => { throw eperm; },
      command: () => ({ command: "", error: "EPERM" }),
    });
    fs.writeFileSync(path.join(runtime, "consumer.lock"), `${JSON.stringify({ pid: 4242, token: "different-token", persona: "codex" })}\n`, { mode: 0o600 });
    const rejected = lockStatus({ paths: { runtime } }, now, {
      kill: () => { throw eperm; },
      command: () => ({ command: "", error: "EPERM" }),
    });
    assert.equal(wrongLock.state, "running");
    assert.equal(rejected.state, "unverifiable-lock", "a fresh heartbeat cannot authenticate a different or PID-reused lock");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("wait-armed rejects a historical armed row from a different live controller generation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-historical-arm."));
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const token = "current-token";
  const now = Date.now();
  fs.writeFileSync(path.join(runtime, "consumer.lock"), `${JSON.stringify({ pid: 4242, token, persona: "codex" })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, "state.json"), `${JSON.stringify({
    schema: 1,
    persona: "codex",
    controllerPid: 4242,
    controllerRunId: "current-run",
    armAttemptId: "current-attempt",
    armedRunId: "current-run",
    armedAttemptId: "current-attempt",
    armedAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    clientStatus: "idle",
    lockTokenHash: createHash("sha256").update(token).digest("hex"),
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, "controller.ndjson"), `${JSON.stringify({
    ts: "2026-07-30T04:00:00.000Z",
    event: "armed",
    threadId: "historical-thread",
    runId: "crashed-run",
    armAttemptId: "crashed-attempt",
  })}\n`, { mode: 0o600 });
  const probes = {
    kill: () => {},
    command: () => ({ command: `${process.execPath} ${path.join(packageRoot, "codex", "controller.mjs")}`, error: null }),
  };
  try {
    await assert.rejects(
      waitArmed({ paths: { runtime } }, 100, 0, { runId: "current-run", armAttemptId: "current-attempt" }, probes),
      /controller armed state timed out/,
    );
    fs.appendFileSync(path.join(runtime, "controller.ndjson"), `${JSON.stringify({
      ts: new Date().toISOString(),
      event: "armed",
      threadId: "current-thread",
      runId: "current-run",
      armAttemptId: "current-attempt",
    })}\n`);
    const armed = await waitArmed(
      { paths: { runtime } },
      100,
      0,
      { runId: "current-run", armAttemptId: "current-attempt" },
      probes,
    );
    assert.equal(armed.threadId, "current-thread");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("wait-armed rejects rather than adopting a foreign live controller run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-foreign-run."));
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const token = "foreign-token";
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(runtime, "consumer.lock"), `${JSON.stringify({ pid: 4242, token, persona: "codex" })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, "state.json"), `${JSON.stringify({
    schema: 1,
    persona: "codex",
    controllerPid: 4242,
    controllerRunId: "foreign-run",
    armAttemptId: "foreign-attempt",
    armedRunId: "foreign-run",
    armedAttemptId: "foreign-attempt",
    armedAt: now,
    heartbeatAt: now,
    clientStatus: "idle",
    lockTokenHash: createHash("sha256").update(token).digest("hex"),
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, "controller.ndjson"), `${JSON.stringify({
    ts: now,
    event: "armed",
    threadId: "foreign-thread",
    runId: "foreign-run",
    armAttemptId: "foreign-attempt",
  })}\n`, { mode: 0o600 });
  const probes = {
    kill: () => {},
    command: () => ({ command: `${process.execPath} ${path.join(packageRoot, "codex", "controller.mjs")}`, error: null }),
  };
  try {
    await assert.rejects(
      waitArmed({ paths: { runtime } }, 100, 0, { runId: "expected-run", armAttemptId: "expected-attempt" }, probes),
      /controller run changed while waiting for armed state/,
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("wait-armed adopts a forward recovery attempt within the same controller run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-forward-arm."));
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const token = "forward-token";
  const now = Date.now();
  const stateFile = path.join(runtime, "state.json");
  const logFile = path.join(runtime, "controller.ndjson");
  const writeState = (attempt, armed = false) => fs.writeFileSync(stateFile, `${JSON.stringify({
    schema: 1,
    persona: "codex",
    controllerPid: 4242,
    controllerRunId: "stable-run",
    armAttemptId: attempt,
    armedRunId: armed ? "stable-run" : null,
    armedAttemptId: armed ? attempt : null,
    armedAt: armed ? new Date().toISOString() : null,
    heartbeatAt: new Date().toISOString(),
    clientStatus: armed ? "idle" : "starting",
    lockTokenHash: createHash("sha256").update(token).digest("hex"),
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, "consumer.lock"), `${JSON.stringify({ pid: 4242, token, persona: "codex" })}\n`, { mode: 0o600 });
  fs.writeFileSync(logFile, `${JSON.stringify({ ts: new Date(now).toISOString(), event: "arming", runId: "stable-run", armAttemptId: "attempt-1" })}\n`, { mode: 0o600 });
  writeState("attempt-1");
  const probes = {
    kill: () => {},
    command: () => ({ command: `${process.execPath} ${path.join(packageRoot, "codex", "controller.mjs")}`, error: null }),
  };
  try {
    const waiting = waitArmed(
      { paths: { runtime } },
      1_000,
      0,
      { runId: "stable-run", armAttemptId: "attempt-1" },
      probes,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    writeState("attempt-2", true);
    fs.appendFileSync(logFile, `${JSON.stringify({
      ts: new Date().toISOString(),
      event: "armed",
      threadId: "recovered-thread",
      runId: "stable-run",
      armAttemptId: "attempt-2",
    })}\n`);
    const armed = await waiting;
    assert.equal(armed.threadId, "recovered-thread");
    assert.equal(armed.armAttemptId, "attempt-2");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("armed-health assertion accepts only ARMED", () => {
  assert.throws(() => assertArmedHealth({ status: "INACTIVE", reasons: [] }), /startup is not armed: INACTIVE/);
  assert.throws(() => assertArmedHealth({ status: "RED", reasons: ["ambiguous"] }), /ambiguous/);
  assert.equal(assertArmedHealth({ status: "ARMED", reasons: [] }).status, "ARMED");
});

test("runtime health exposes every reviewed fault class and never maps INACTIVE to green", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-health."));
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const manifest = { paths: { runtime } };
  const now = Date.parse("2026-07-30T05:00:00Z");
  const base = {
    schema: 1,
    persona: "codex",
    controllerPid: 4242,
    controllerRunId: "current-run",
    armAttemptId: "current-attempt",
    armedRunId: "current-run",
    armedAttemptId: "current-attempt",
    armedAt: new Date(now - 1_000).toISOString(),
    heartbeatAt: new Date(now - 1_000).toISOString(),
    clientStatus: "idle",
  };
  const write = (patch) => fs.writeFileSync(path.join(runtime, "state.json"), `${JSON.stringify({ ...base, ...patch })}\n`, { mode: 0o600 });
  try {
    write({});
    assert.equal(runtimeHealth(manifest, { state: "stopped" }, now).status, "INACTIVE");
    for (const [name, patch, pattern] of [
      ["degraded", { degraded: { at: "x", reason: "lost child" } }, /degraded/],
      ["recovery", { recovery: { at: "x" } }, /recovery incomplete/],
      ["stale heartbeat", { heartbeatAt: new Date(now - 60_000).toISOString() }, /heartbeat is stale/],
      ["stale pending", { pendingSince: new Date(now - 181_000).toISOString() }, /relevant event pending/],
      ["unavailable child", { clientStatus: "unavailable" }, /app-server is unavailable/],
    ]) {
      write(patch);
      const health = runtimeHealth(manifest, { state: "running", pid: 4242 }, now);
      assert.equal(health.status, "RED", name);
      assert.match(health.reasons.join(" "), pattern, name);
    }
    write({});
    const unverifiable = runtimeHealth(manifest, { state: "unverifiable-lock", pid: 4242 }, now);
    assert.equal(unverifiable.status, "RED");
    assert.match(unverifiable.reasons.join(" "), /unverifiable-lock/);
    fs.writeFileSync(path.join(runtime, "state.json"), "{broken\n", { mode: 0o600 });
    const corrupt = runtimeHealth(manifest, { state: "stopped" }, now);
    assert.equal(corrupt.status, "RED");
    assert.match(corrupt.reasons.join(" "), /runtime state is unreadable/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stale locks are reaped atomically, while heartbeat-only ownership can never be signalled", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hive-test.stale-lock."));
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const manifest = { paths: { runtime } };
  const lockFile = path.join(runtime, "consumer.lock");
  const dead = { kill: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }, command: () => ({ command: "", error: "ps-failed" }) };
  try {
    fs.writeFileSync(lockFile, `${JSON.stringify({ pid: 4242, token: "dead-token", persona: "codex" })}\n`, { mode: 0o600 });
    assert.equal(reapStaleLock(manifest, Date.now(), dead).state, "reaped-stale-lock");
    assert.equal(fs.existsSync(lockFile), false);

    const now = Date.now();
    fs.writeFileSync(lockFile, `${JSON.stringify({ pid: 4242, token: "live-token", persona: "codex" })}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(runtime, "state.json"), `${JSON.stringify({
      schema: 1,
      persona: "codex",
      controllerPid: 4242,
      lockTokenHash: createHash("sha256").update("live-token").digest("hex"),
      heartbeatAt: new Date(now).toISOString(),
    })}\n`, { mode: 0o600 });
    let signalled = false;
    const heartbeatOnly = {
      kill: (_pid, signal) => {
        if (signal === 0) throw Object.assign(new Error("not permitted"), { code: "EPERM" });
        signalled = true;
      },
      command: () => ({ command: "", error: "EPERM" }),
    };
    await assert.rejects(stop(manifest, heartbeatOnly), /without process-command ownership evidence/);
    assert.equal(signalled, false);
    assert.equal(fs.existsSync(lockFile), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

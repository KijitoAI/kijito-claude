import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lockStatus } from "../cli.mjs";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const installer = path.join(packageRoot, "install.mjs");

function run(args, expected = 0) {
  const direct = !args[0].endsWith(".mjs");
  const result = direct
    ? spawnSync(args[0], args.slice(1), { encoding: "utf8" })
    : spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-kijito-package."));
  fs.chmodSync(root, 0o700);
  const ordinary = path.join(root, "ordinary");
  const monitor = path.join(root, "monitor");
  fs.mkdirSync(ordinary, { mode: 0o700 });
  fs.mkdirSync(monitor, { mode: 0o700 });
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
  fs.copyFileSync(process.execPath, realBin);
  fs.chmodSync(realBin, 0o700);
  fs.symlinkSync(realBin, bin);
  return {
    root,
    installRoot: path.join(root, "share", "codex-kijito-hive"),
    launcher: path.join(root, "bin", "codex-kijito-hive"),
    // Hermetic skills target. Without this the installer's default (~/.codex/skills) would make
    // the test suite deploy into the developer's real Codex install.
    skillsRoot: path.join(root, "codex-skills"),
    auth, config, token, events, bin,
  };
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

test("release install, doctor, duplicate refusal, and manifest-bound uninstall", () => {
  const f = fixture();
  try {
    const ordinaryBefore = fs.readFileSync(f.config, "utf8");
    const authBefore = fs.readFileSync(f.auth, "utf8");
    const installed = JSON.parse(run(installArgs(f)).stdout);
    assert.equal(installed.status, "INSTALLED");
    assert.equal(installed.ordinaryStateUnchanged, true);
    // A full install also deploys the skills, into the fixture's own root -- never the real one.
    assert.deepEqual(installed.skills.map((s) => s.skill).sort(), ["kijito-qa-memory", "kijito-start"]);
    assert.ok(installed.skills.every((s) => s.target.startsWith(f.skillsRoot)));
    const manifest = JSON.parse(fs.readFileSync(path.join(f.installRoot, "installed-manifest.json"), "utf8"));
    assert.equal(manifest.paths.codexBin, fs.realpathSync(f.bin));
    const doctor = JSON.parse(run([f.launcher, "doctor"]).stdout);
    assert.equal(doctor.status, "GREEN");
    assert.equal(doctor.hooksDisabled, true);
    assert.equal(doctor.launchAgentInstalled, false);
    assert.equal(doctor.workspaceEmpty, true);
    assert.equal(doctor.ordinaryStateMatchesInstallSnapshot, true);
    fs.writeFileSync(path.join(f.installRoot, "runtime", "state.json"), `${JSON.stringify({
      schema: 1,
      persona: "codex",
      ambiguous: { at: "2026-07-29T20:14:31.692Z", reason: "acceptance unknown", batch: [] },
    })}\n`, { mode: 0o600 });
    const unhealthy = JSON.parse(run([f.launcher, "doctor"], 1).stdout);
    assert.equal(unhealthy.status, "RED");
    assert.match(unhealthy.wake.reasons.join(" "), /delivery ambiguous since 2026-07-29T20:14:31\.692Z/);
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
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
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
    const launcherBytes = fs.readFileSync(f.launcher);
    fs.appendFileSync(f.launcher, "\n# tamper\n");
    run([f.launcher, "uninstall", "--confirm-dedicated-home"], 1);
    fs.writeFileSync(f.launcher, launcherBytes, { mode: 0o700 });
    run([f.launcher, "uninstall", "--confirm-dedicated-home"]);
    assert.equal(fs.existsSync(f.installRoot), false);
    assert.equal(fs.existsSync(f.launcher), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("smoke command fences armed evidence to bytes written after its own start", () => {
  const cli = fs.readFileSync(path.join(packageRoot, "cli.mjs"), "utf8");
  assert.match(cli, /const logOffset = fs\.existsSync\(logFile\) \? fs\.statSync\(logFile\)\.size : 0/);
  assert.match(cli, /const armed = await waitArmed\(manifest, 180_000, logOffset\)/);
  assert.match(cli, /armed: started\.armed/);
  assert.match(cli, /bytes\.subarray\(logOffset\)/);
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
      heartbeatAt: new Date(now - 1_000).toISOString(),
    })}\n`, { mode: 0o600 });
    const eperm = Object.assign(new Error("not permitted"), { code: "EPERM" });
    const status = lockStatus({ paths: { runtime } }, now, {
      kill: () => { throw eperm; },
      command: () => ({ command: "", error: "EPERM" }),
    });
    assert.equal(status.state, "running");
    assert.equal(status.evidence, "private-heartbeat");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// This executable mutation manifest records each claim, its exact source mutation, and the named
// assertion which must go RED. Every specimen refreshes gated hashes before it runs, so a stale
// release manifest cannot masquerade as semantic mutation coverage.
const source = path.resolve(process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const node = process.env.CODEX_KIJITO_NODE ?? process.execPath;
const unit = "providers/codex/test/codex-hive-watch.test.mjs";
const packaging = "providers/codex/test/release-packaging.test.mjs";
const selected = process.argv[3] ? new Set(process.argv[3].split(",")) : null;

function replaceOnce(root, file, before, after) {
  const target = path.join(root, file);
  const text = fs.readFileSync(target, "utf8");
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${file}: mutation anchor is absent or non-unique`);
  }
  fs.writeFileSync(target, `${text.slice(0, first)}${after}${text.slice(first + before.length)}`);
}

function targetFailed(output, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:not ok \\d+ - |[✖✘]\\s+)${escaped}(?:\\s|$)`, "m").test(output);
}

const mutations = [
  {
    id: "M1",
    claim: "terminal delivery must not wait for idle before acceptance",
    target: "post-surface idle loss restarts the child and rearms without replaying the completed wake",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "    return { turnId: started.turn.id, text: result.text, digest };",
        "    await this.waitForIdle(10);\n    return { turnId: started.turn.id, text: result.text, digest };");
    },
  },
  {
    id: "M2",
    claim: "unexpected child exit must notify the controller",
    target: "idle app-server death becomes visible, recovers, and delivers the next event",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "    this.onExit({ code, signal, reason: error?.message, expected: this.stopping });",
        "    // MUTATION: suppress controller exit notification");
    },
  },
  {
    id: "M3",
    claim: "cleanly stopped ownership is INACTIVE, never GREEN",
    target: "runtime health exposes every reviewed fault class and never maps INACTIVE to green",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "    status: reasons.length === 0 ? (controller.state === \"running\" ? \"ARMED\" : \"INACTIVE\") : \"RED\",",
        "    status: reasons.length === 0 ? (controller.state === \"running\" ? \"ARMED\" : \"GREEN\") : \"RED\",");
    },
  },
  {
    id: "M4",
    claim: "stop releases the consumer lock even when child stop throws",
    target: "controller stop releases its lock even when app-server termination throws",
    files: [unit],
    mutate(root) {
      const file = path.join(root, "providers/codex/controller.mjs");
      const text = fs.readFileSync(file, "utf8");
      const anchor = "      releaseLock(this.lock);\n      this.lock = null;";
      const at = text.lastIndexOf(anchor);
      if (at < 0) throw new Error("M4 stop release anchor missing");
      fs.writeFileSync(file, `${text.slice(0, at)}      // MUTATION: leak stop-path lock${text.slice(at + anchor.length)}`);
    },
  },
  {
    id: "M5",
    claim: "heartbeat-only ownership is never signalled",
    target: "stale locks are reaped atomically, while heartbeat-only ownership can never be signalled",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "  if (current.evidence !== \"process-command\") throw new Error(\"refusing to signal controller without process-command ownership evidence\");",
        "  if (current.evidence !== \"process-command\") { probes.kill(current.pid, \"SIGTERM\"); return { status: \"STOPPED\", pid: current.pid }; }");
    },
  },
  {
    id: "M6",
    claim: "two install roots on one persona stream share one lock namespace",
    target: "two install roots sharing one event-directory/persona stream cannot double-arm",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "  const eventsFile = expand(values[\"events-file\"] ?? path.join(home, \".cache\", \"kijito-inbox-monitor\", \"events.codex.ndjson\"));\n  const lockFile = defaultConsumerLockFile(eventsFile, \"codex\");",
        "  const eventsFile = expand(values[\"events-file\"] ?? path.join(home, \".cache\", \"kijito-inbox-monitor\", \"events.codex.ndjson\"));\n  const installRoot = expand(values[\"install-root\"] ?? path.join(home, \".local\", \"share\", \"codex-kijito-hive\"));\n  const lockFile = path.join(path.dirname(installRoot), `.consumer.${path.basename(installRoot)}.lock`);");
      replaceOnce(root, "providers/codex/install.mjs",
        "    installRoot: expand(values[\"install-root\"] ?? path.join(home, \".local\", \"share\", \"codex-kijito-hive\")),",
        "    installRoot,");
      replaceOnce(root, "providers/codex/install.mjs",
        "  if (lockFile !== expected) throw new Error(\"consumer lock is not the deterministic Codex lock under the event-stream directory\");",
        "  void expected; // MUTATION: accept a per-install-root lock namespace");
      replaceOnce(root, "providers/codex/controller.mjs",
        "  if (lockFile !== defaultConsumerLockFile(eventsFile)) throw new Error(\"consumer lock must be the deterministic persona lock under the event-stream directory\");",
        "  // MUTATION: accept a per-install-root lock namespace");
      replaceOnce(root, "providers/codex/controller.mjs",
        "  const lockFile = defaultConsumerLockFile(eventsFile);\n  if (values.lock !== undefined && path.resolve(values.lock) !== lockFile) {\n    throw new Error(\"--lock must equal the deterministic persona lock under the event-stream directory\");\n  }",
        "  const lockFile = values.lock !== undefined ? path.resolve(values.lock) : defaultConsumerLockFile(eventsFile);");
      replaceOnce(root, "providers/codex/cli.mjs",
        "  if (lockFileFor(manifest) !== expectedLockFile) throw new Error(\"manifest consumer lock is not the deterministic lock under the event-stream directory\");",
        "  void expectedLockFile; // MUTATION: accept a per-install-root lock namespace");
    },
  },
  {
    id: "M7",
    claim: "upgrade preserves an inherited cursor instead of jumping to EOF",
    target: "upgrade preserves thread and cursor, replays window events, and keeps one event-directory/persona lock",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "    if (state.schema !== 1 || state.persona !== \"codex\") throw new Error(\"old runtime state identity mismatch\");",
        "    if (state.schema !== 1 || state.persona !== \"codex\") throw new Error(\"old runtime state identity mismatch\");\n    state.offset = fs.statSync(eventsFile).size;");
    },
  },
  {
    id: "M8",
    claim: "each wake attempt uses a unique clientUserMessageId",
    target: "identical reconciliations in one app-server process use distinct idempotency keys",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        '        clientUserMessageId: `kijito-wake-v1-${digest}-${randomBytes(12).toString("hex")}`,',
        "        clientUserMessageId: `kijito-wake-v1-${digest}`,");
    },
  },
  {
    id: "M9",
    claim: "queued metadata is persisted before delivery",
    target: "queued event metadata survives a controller crash before delivery",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "    this.state.pendingItems = this.pending.map(({ kind, id, key, trigger }) => ({ kind, id, key, trigger }));",
        "    this.state.pendingItems = []; // MUTATION: drop queued metadata");
    },
  },
  {
    id: "M10",
    claim: "the drift gate compares installed Codex runtime bytes",
    target: "drift gate compares installed Codex controller, shared core, and CLI bytes",
    files: [packaging],
    mutate(root) {
      const file = path.join(root, "tests/drift_test.sh");
      const text = fs.readFileSync(file, "utf8");
      const marker = "# The executable Codex wake runtime";
      const start = text.indexOf(marker);
      const at = text.indexOf('    if [ "$(shasum -a 256 "$source" | cut -d\' \' -f1)" = "$(shasum -a 256 "$installed" | cut -d\' \' -f1)" ]; then', start);
      if (start < 0 || at < 0) throw new Error("M10 Codex drift comparison anchor missing");
      const before = '    if [ "$(shasum -a 256 "$source" | cut -d\' \' -f1)" = "$(shasum -a 256 "$installed" | cut -d\' \' -f1)" ]; then';
      fs.writeFileSync(file, `${text.slice(0, at)}    if true; then${text.slice(at + before.length)}`);
    },
  },
  {
    id: "M11",
    claim: "doctor integrity exceptions are structured RED",
    target: "release install, doctor, duplicate refusal, and manifest-bound uninstall",
    files: [packaging],
    mutate(root) {
      const file = path.join(root, "providers/codex/cli.mjs");
      const text = fs.readFileSync(file, "utf8");
      const start = text.indexOf("function doctorFailure");
      const end = text.indexOf("export function doctor", start);
      if (start < 0 || end < 0) throw new Error("M11 doctorFailure anchor missing");
      const segment = text.slice(start, end).replaceAll('"RED"', '"INACTIVE"');
      fs.writeFileSync(file, `${text.slice(0, start)}${segment}${text.slice(end)}`);
    },
  },
  {
    id: "M12",
    claim: "an uncertain mail batch is reconciled, never replayed",
    target: "real app-server loss at turn/start reconciles without replaying the uncertain mail batch",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "      await this.replaceClient();\n      this.state.ambiguous = null;",
        "      await this.replaceClient();\n      if (recoveringAmbiguity) for (const item of this.state.ambiguous.batch ?? []) this.queue(item);\n      this.state.ambiguous = null;");
    },
  },
  {
    id: "M13",
    claim: "a new controller run clears stale arm evidence before app-server startup",
    target: "hard-crash restart and SIGUSR1 stay RED until the current arming attempt completes",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "    this.state.armedAt = null;\n    this.state.armedRunId = null;\n    this.state.armedAttemptId = null;\n    this.state.clientStatus = \"starting\";",
        "    // MUTATION: retain stale arm evidence and idle client status");
    },
  },
  {
    id: "M14",
    claim: "consumer locks live in the strict private package namespace",
    target: "runtime path validator rejects non-private and non-empty boundaries",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/_shared/wake-core.mjs",
        "  return path.join(path.dirname(path.resolve(eventsFile)), \".codex-hive-locks\", `consumer.${persona}.lock`);",
        "  return path.join(path.dirname(path.resolve(eventsFile)), `consumer.${persona}.lock`);");
    },
  },
  {
    id: "M15",
    claim: "wait-armed accepts evidence only from the current run and arming attempt",
    target: "wait-armed rejects a historical armed row from a different live controller generation",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "    const armed = rows.findLast((row) => [\"armed\", \"rearmed-after-codex-restart\"].includes(row.event)\n      && row.runId === run.runId && row.armAttemptId === run.armAttemptId);",
        "    const armed = rows.findLast((row) => [\"armed\", \"rearmed-after-codex-restart\"].includes(row.event));");
    },
  },
  {
    id: "M16",
    claim: "upgrade permission rejection occurs before stopping the running old consumer",
    target: "upgrade preflight rejection leaves the running old consumer and lock token untouched",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "  ensureLockDirectory(options.eventsFile, options.lockFile);\n  options.installRoot = path.join(fs.realpathSync(path.dirname(options.installRoot)), path.basename(options.installRoot));",
        "  options.installRoot = path.join(fs.realpathSync(path.dirname(options.installRoot)), path.basename(options.installRoot));");
      replaceOnce(root, "providers/codex/install.mjs",
        "  const heldUpgradeLock = acquireUpgradeLock(upgradeLock);",
        "  let heldUpgradeLock = null;");
      replaceOnce(root, "providers/codex/install.mjs",
        "    const stagedOptions = { ...options, installRoot: stagedRoot, launcher: stagedLauncher, upgrade: false };\n    install(stagedOptions, { skipSkills: true });\n\n    const stopped = runLauncher(options.launcher, [\"stop\"], options.nodeBin, 170_000);\n    if (stopped.status !== 0) throw new Error(`existing controller did not stop cleanly: ${stopped.stderr || stopped.stdout}`);",
        "    const stopped = runLauncher(options.launcher, [\"stop\"], options.nodeBin, 170_000);\n    if (stopped.status !== 0) throw new Error(`existing controller did not stop cleanly: ${stopped.stderr || stopped.stdout}`);\n    ensureLockDirectory(options.eventsFile, options.lockFile);\n    heldUpgradeLock = acquireUpgradeLock(upgradeLock);\n    const stagedOptions = { ...options, installRoot: stagedRoot, launcher: stagedLauncher, upgrade: false };\n    install(stagedOptions, { skipSkills: true });");
    },
  },
  {
    id: "M17",
    claim: "stop drains recovery and restart replacement work before touching the new child",
    target: "stop drains an in-progress app-server replacement before stopping the new child",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "    while ((this.busy || this.recovering || this.restarting) && Date.now() < drainDeadline) {",
        "    while (this.busy && Date.now() < drainDeadline) {");
    },
  },
  {
    id: "M18",
    claim: "wait-armed follows a forward recovery attempt within the same controller run",
    target: "start follows forward recovery attempts and returns ARMED instead of stopping the recovered controller",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "    if (runtime.armAttemptId !== run.armAttemptId) run = { ...run, armAttemptId: runtime.armAttemptId };",
        "    if (runtime.armAttemptId !== run.armAttemptId) throw new Error(\"arming generation changed while waiting for armed state\");");
    },
  },
  {
    id: "M19",
    claim: "explicit restart excludes ordinary poll delivery until replacement is ready",
    target: "restart excludes concurrent recovery, then a retained degraded latch self-recovers",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "    if (this.busy || this.recovering || (this.restarting && !allowRestarting) || this.stopping || this.pending.length === 0 || this.state.ambiguous || this.state.degraded) return;",
        "    if (this.busy || this.recovering || this.stopping || this.pending.length === 0 || this.state.ambiguous || this.state.degraded) return;");
    },
  },
  {
    id: "M20",
    claim: "a recovery declined during explicit restart retains a future recovery owner",
    target: "a scheduled ambiguous recovery that fires during restart remains scheduled and rearms",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/controller.mjs",
        "      if (this.restarting) this.scheduleRecovery();",
        "      // MUTATION: discard the timer that fired during restart");
    },
  },
  {
    id: "M21",
    claim: "configured upgrade paths cannot drift before the running consumer is stopped",
    target: "upgrade refuses configured-path drift before stopping the running consumer",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "  requireUpgradePathContinuity(options, oldManifest);",
        "  // MUTATION: silently accept configured-path drift");
    },
  },
  {
    id: "M22",
    claim: "a failed legacy stop that already exited must re-arm the pre-swap controller",
    target: "failed legacy stop that already exited is re-armed before upgrade returns failure",
    files: [packaging],
    mutate(root) {
      const file = path.join(root, "providers/codex/install.mjs");
      const sourceText = fs.readFileSync(file, "utf8");
      const start = sourceText.indexOf("    } else if (wasRunning) {\n      // A stop command can fail or time out after the old controller has already exited.");
      const end = sourceText.indexOf("\n    }\n    throw error;", start);
      if (start < 0 || end < 0) throw new Error("M22 legacy re-arm anchor missing");
      fs.writeFileSync(file, `${sourceText.slice(0, start)}    }${sourceText.slice(end + 6)}`);
    },
  },
  {
    id: "M23",
    claim: "successful upgrades retain only bounded private rollback roots and launcher copies",
    target: "successful upgrades retain only the two newest private rollback roots and launchers",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "  for (const { bucket, parent, prefix, kind, recursive } of groups) {",
        "  for (const { bucket, parent, prefix, kind, recursive } of []) {");
    },
  },
  {
    id: "M24",
    claim: "the live gate refuses unresolved legacy ownership before creating canonical runtime paths",
    target: "live-gate helper refuses unresolved legacy ownership before preparing canonical paths",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/test/prepare-live-gate.mjs",
        "  throw new Error(`refusing live gate while legacy consumer lock exists: ${lockFile}; stop or migrate the legacy controller first`);",
        "  return; // MUTATION: permit cross-version double-arm preparation");
    },
  },
  {
    id: "M25",
    claim: "the shared lock helper produces the exact reviewed private persona namespace",
    target: "direct controller defaults to the deterministic event-directory/persona lock",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/_shared/wake-core.mjs",
        "  return path.join(path.dirname(path.resolve(eventsFile)), \".codex-hive-locks\", `consumer.${persona}.lock`);",
        "  return path.join(path.dirname(path.resolve(eventsFile)), `consumer.${persona}.lock`);");
    },
  },
  {
    id: "M26",
    claim: "smoke always stops the controller after validating its own armed generation",
    target: "smoke behavior accepts only its own armed generation and leaves the controller inactive",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "    } finally { await stop(manifest); }",
        "    } finally { /* MUTATION: leak the smoke controller */ }");
    },
  },
  {
    id: "M27",
    claim: "a missing shared core still reaches the CLI structured RED handler",
    target: "doctor and uninstall fail closed on installed-byte tampering",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "} catch (error) { wakeCoreImportError = error; }",
        "} catch (error) { throw error; }");
    },
  },
  {
    id: "M28",
    claim: "an installed CLI never falls back to a shared core outside its manifest-owned root",
    target: "doctor and uninstall fail closed on installed-byte tampering",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "const wakeCoreModuleFile = fs.existsSync(manifestFile) ? wakeCoreFile : path.join(installRoot, \"..\", \"_shared\", \"wake-core.mjs\");",
        "const wakeCoreModuleFile = fs.existsSync(wakeCoreFile) ? wakeCoreFile : path.join(installRoot, \"..\", \"_shared\", \"wake-core.mjs\");");
    },
  },
  {
    id: "M29",
    claim: "unverifiable legacy ownership after a failed stop never authorizes blind re-arm",
    target: "failed legacy stop with unverifiable ownership refuses a blind re-arm",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "      if ([\"stopped\", \"stale-lock\"].includes(currentState)) {",
        "      if (currentState !== \"running\") {");
    },
  },
  {
    id: "M30",
    claim: "a successful legacy stop must positively prove ownership stopped before canonical swap",
    target: "legacy stop success must prove ownership stopped before canonical swap",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "    const stoppedOwnership = runLauncher(options.launcher, [\"status\"], options.nodeBin, 30_000);\n    if (stoppedOwnership.json?.status?.state !== \"stopped\") {\n      throw new Error(`existing controller did not prove stopped ownership after stop: ${stoppedOwnership.stderr || stoppedOwnership.stdout}`);\n    }\n",
        "    // MUTATION: trust the stop exit code without proving ownership stopped\n");
    },
  },
  {
    id: "M31",
    claim: "wait-armed never adopts a foreign controller run",
    target: "wait-armed rejects rather than adopting a foreign live controller run",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "    if (runtime.controllerRunId !== run.runId) throw new Error(\"controller run changed while waiting for armed state\");",
        "    if (runtime.controllerRunId !== run.runId) run = { runId: runtime.controllerRunId, armAttemptId: runtime.armAttemptId };");
    },
  },
  {
    id: "M32",
    claim: "structured failures distinguish usage from wake-path integrity",
    target: "release install, doctor, duplicate refusal, and manifest-bound uninstall",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "function failureCategory(error) {\n  const message = String(error?.message ?? error);",
        "function failureCategory(error) {\n  return \"integrity\"; // MUTATION: flatten the verdict taxonomy\n  const message = String(error?.message ?? error);");
    },
  },
  {
    id: "M33",
    claim: "failed live-gate preparation removes the temporary auth root",
    target: "live-gate preparation returns cleanup ownership and removes partial auth fixtures on failure",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/test/prepare-live-gate.mjs",
        "    try { cleanupLiveGate(root, tempRoot); } catch {}",
        "    // MUTATION: orphan the partially prepared private root");
    },
  },
  {
    id: "M34",
    claim: "retention failures cannot fail or roll back a verified upgrade",
    target: "retention failure is reported after a verified upgrade without rolling it back",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/install.mjs",
        "  let retention;\n  try {\n    try { retention = prune(options.installRoot, options.launcher); }\n    catch (error) {\n      retention = { roots: [], launchers: [], warnings: [{ file: null, code: error.code ?? null, message: error.message }] };\n    }\n  } finally { releaseUpgradeLock(heldUpgradeLock); }",
        "  const retention = prune(options.installRoot, options.launcher); // MUTATION: cleanup failure escapes and leaks upgrade ownership");
    },
  },
  {
    id: "M35",
    claim: "expired live-gate auth roots are actually pruned",
    target: "live-gate cleanup is prefix-scoped and stale private gates are pruned",
    files: [unit],
    mutate(root) {
      replaceOnce(root, "providers/codex/test/prepare-live-gate.mjs",
        "      if (now - stat.mtimeMs < maxAgeMs || !removableLiveGate(root, tempRoot) || liveGateControllerActive(root)) continue;",
        "      continue; // MUTATION: retain every stale auth fixture");
    },
  },
  {
    id: "M36",
    claim: "untrusted parse-error text cannot select the internal usage category",
    target: "release install, doctor, duplicate refusal, and manifest-bound uninstall",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "  if (error instanceof SyntaxError\n    || [\"EACCES\", \"EPERM\", \"ENOENT\", \"ENOTDIR\", \"ERR_MODULE_NOT_FOUND\"].includes(error?.code)) return \"integrity\";",
        "  if (/unknown command|requires --confirm|invalid argument/.test(message)) return \"usage\"; // MUTATION: let untrusted bytes steer taxonomy\n  if (error instanceof SyntaxError\n    || [\"EACCES\", \"EPERM\", \"ENOENT\", \"ENOTDIR\", \"ERR_MODULE_NOT_FOUND\"].includes(error?.code)) return \"integrity\";");
    },
  },
  {
    id: "M37",
    claim: "direct CLI execution recognizes symlink and /var realpath aliases",
    target: "release install, doctor, duplicate refusal, and manifest-bound uninstall",
    files: [packaging],
    mutate(root) {
      replaceOnce(root, "providers/codex/cli.mjs",
        "if (process.argv[1]\n  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {",
        "if (import.meta.url === `file://${process.argv[1]}`) { // MUTATION: raw path aliases silently no-op");
    },
  },
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-round3-mutations."));
const results = [];
try {
  for (const mutation of mutations.filter(({ id }) => !selected || selected.has(id))) {
    const specimen = path.join(root, mutation.id.toLowerCase());
    fs.cpSync(source, specimen, {
      recursive: true,
      filter: (entry) => ![".git", ".qa-tmp"].includes(path.basename(entry)),
    });
    const specimenTmp = path.join(specimen, ".mutation-tmp");
    fs.mkdirSync(specimenTmp, { mode: 0o700 });
    mutation.mutate(specimen);
    const refreshed = spawnSync(node, ["providers/codex/tools/refresh-manifest.mjs"], {
      cwd: specimen, encoding: "utf8", timeout: 30_000,
    });
    if (refreshed.status !== 0) throw new Error(`${mutation.id} manifest refresh failed: ${refreshed.stdout}${refreshed.stderr}`);
    const test = spawnSync(node, ["--test", `--test-name-pattern=${mutation.target}`, ...mutation.files], {
      cwd: specimen, encoding: "utf8", timeout: 90_000, maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        CODEX_KIJITO_NODE: node,
        TMPDIR: specimenTmp,
        TMP: specimenTmp,
        TEMP: specimenTmp,
      },
    });
    const output = `${test.stdout}${test.stderr}`;
    const red = test.status !== 0 && targetFailed(output, mutation.target);
    results.push({ id: mutation.id, claim: mutation.claim, targetedAssertion: mutation.target, manifestRefreshed: true, red, exit: test.status });
    if (!red) throw new Error(`${mutation.id} did not fail at targeted assertion ${mutation.target}\n${output.slice(-6000)}`);
    fs.rmSync(specimen, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", count: results.length, results }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

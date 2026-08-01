#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

const NOW = Date.parse("2026-07-30T23:10:00.000Z");

async function validationCase(mutate) {
  const [{ fixtureSpecimen }, { sha256 }, { requiredCaseNames, validateSpecimen }, { renderPrompt }] = await Promise.all([
    import("../n0-harness/fixture.mjs"),
    import("../n0-harness/lib.mjs"),
    import("../n0-harness/oracle.mjs"),
    import("../n0-harness/prompt.mjs"),
  ]);
  const specimen = fixtureSpecimen();
  mutate(specimen, { sha256 });
  rebuildPrompts(specimen, { requiredCaseNames, renderPrompt, sha256 });
  validateSpecimen(specimen);
  return { accepted: true, code: "VALIDATE_SPECIMEN_ACCEPTED" };
}

async function validationNoRebuildCase(mutate) {
  const [{ fixtureSpecimen }, { validateSpecimen }] = await Promise.all([
    import("../n0-harness/fixture.mjs"),
    import("../n0-harness/oracle.mjs"),
  ]);
  const specimen = fixtureSpecimen();
  mutate(specimen);
  validateSpecimen(specimen);
  return { accepted: true, code: "VALIDATE_SPECIMEN_ACCEPTED" };
}

async function permissionCase(configure = () => {}) {
  const [{ fixturePermissionEvidence, fixtureSpecimen }, { validatePermissionEvidence }] = await Promise.all([
    import("../n0-harness/fixture.mjs"),
    import("../n0-harness/oracle.mjs"),
  ]);
  const context = { specimen: fixtureSpecimen() };
  context.evidence = fixturePermissionEvidence(context.specimen);
  configure(context);
  validatePermissionEvidence(context.specimen, context.evidence);
  return { accepted: true, code: "PERMISSION_EVIDENCE_ACCEPTED" };
}

function rebuildPrompts(specimen, { requiredCaseNames, renderPrompt, sha256 }) {
  for (const name of requiredCaseNames()) {
    const utf8 = renderPrompt(specimen, name);
    specimen.prompts[name] = { utf8, sha256: sha256(Buffer.from(utf8, "utf8")) };
  }
}

function addRolloutEntry(specimen) {
  const entry = { path: "session.jsonl", dev: 1, ino: 2, size: 10, mtimeMs: 3, firstRecordType: "session_meta" };
  specimen.rollout.preActionSnapshot.entries = [entry];
  specimen.rollout.preActionSnapshot.totalBytes = entry.size;
  return entry;
}

async function oracleCase(mutate) {
  const [{ fixtureEvidence, fixtureSpecimen }, { sha256 }, { evaluateOracle, requiredCaseNames }, { renderPrompt }] = await Promise.all([
    import("../n0-harness/fixture.mjs"),
    import("../n0-harness/lib.mjs"),
    import("../n0-harness/oracle.mjs"),
    import("../n0-harness/prompt.mjs"),
  ]);
  const specimen = fixtureSpecimen();
  const evidence = fixtureEvidence(specimen, NOW);
  const context = { specimen, evidence, nowMs: NOW };
  mutate(context);
  rebuildPrompts(context.specimen, { requiredCaseNames, renderPrompt, sha256 });
  const result = evaluateOracle(context.specimen, context.evidence, context.nowMs);
  return { accepted: result?.status === "N0_TEST_CAPABLE", code: result?.code ?? "ORACLE_UNDEFINED", status: result?.status ?? "UNDEFINED" };
}

async function policyCase() {
  const { requiredCasePolicy } = await import("../n0-harness/oracle.mjs");
  requiredCasePolicy("UNKNOWN");
  return { accepted: true, code: "CASE_POLICY_ACCEPTED" };
}

async function libCase(name, args) {
  const lib = await import("../n0-harness/lib.mjs");
  lib[name](...args);
  return { accepted: true, code: "HELPER_ACCEPTED" };
}

function shadowStat(stat, overrides) {
  const shadow = Object.create(stat);
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(shadow, key, { value });
  return shadow;
}

async function readFileCase(configure = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n0-read-pair."));
  const target = path.join(root, "a.json");
  fs.writeFileSync(target, "{}\n");
  const context = { args: { root, target, options: {} }, cleanup: [], restorers: [] };
  const patch = (object, key, replacement) => {
    const original = object[key];
    object[key] = replacement(original);
    context.restorers.push(() => { object[key] = original; });
  };
  try {
    configure(context, patch);
    const lib = await import("../n0-harness/lib.mjs");
    lib.readOwnedRegularFile(context.args.root, context.args.target, context.args.options);
    return { accepted: true, code: "READ_FILE_ACCEPTED" };
  } finally {
    for (const restore of context.restorers.reverse()) restore();
    for (const extra of context.cleanup.reverse()) fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function parserModules() {
  const [fixture, lib, parser] = await Promise.all([
    import("../n0-harness/fixture.mjs"),
    import("../n0-harness/lib.mjs"),
    import("../n0-harness/parser.mjs"),
  ]);
  return { fixture, lib, parser };
}

async function parseRolloutCase(input) {
  const { parser } = await parserModules();
  parser.parseRollout(input);
  return { accepted: true, code: "PARSE_ROLLOUT_ACCEPTED" };
}

async function nonceCase(configure = () => {}) {
  const { fixture, parser } = await parserModules();
  const args = {
    records: parser.parseRollout(fixture.fixtureRollout()).records,
    nonce: fixture.FIXED.runNonce,
    options: {},
  };
  configure(args, { fixture, parser });
  parser.requireNonceInOneUserTurn(args.records, args.nonce, args.options);
  return { accepted: true, code: "NONCE_ACCEPTED" };
}

async function markerCase(configure = () => {}) {
  const { fixture, parser } = await parserModules();
  const args = {
    markerNonce: fixture.FIXED.markerNonce,
    candidates: [{ path: "a.jsonl", text: fixture.fixtureRollout({ nonce: fixture.FIXED.markerNonce }) }],
  };
  configure(args, { fixture, parser });
  parser.selectMarkerRollout(args.candidates, args.markerNonce);
  return { accepted: true, code: "MARKER_ACCEPTED" };
}

async function scheduledCase(configure = () => {}) {
  const { fixture, parser } = await parserModules();
  const specimen = fixture.fixtureSpecimen();
  const args = {
    rolloutText: fixture.fixtureRollout({ environment: specimen.environment }),
    runRecord: fixture.fixtureRunRecord(),
    expected: fixture.fixtureExpected(specimen),
  };
  configure(args, { fixture, parser, specimen });
  parser.verifyScheduledRun(args);
  return { accepted: true, code: "SCHEDULED_ACCEPTED" };
}

async function pointerCase(configure = () => {}) {
  const { fixture, lib, parser } = await parserModules();
  const args = { raw: fixture.fixtureKijitoGet(), expectedId: fixture.FIXED.pointerId, expectedPersona: "codex" };
  configure(args, { fixture, lib, parser });
  parser.parseKijitoMainBody(args.raw, args.expectedId, args.expectedPersona);
  return { accepted: true, code: "POINTER_ACCEPTED" };
}

async function mailCase(configure = () => {}) {
  const { fixture, parser } = await parserModules();
  const args = {
    records: parser.parseRollout(fixture.fixtureRollout({ extraRecords: [fixture.fixtureMailRecord()] })).records,
    options: { rowId: 77, bodyNonce: fixture.FIXED.bodyNonce },
  };
  configure(args, { fixture, parser });
  parser.verifyExactMailFetch(args.records, args.options);
  return { accepted: true, code: "MAIL_ACCEPTED" };
}

async function secretCase(configure = () => {}) {
  const { fixture, parser } = await parserModules();
  const args = { surfaces: { prompt: `leak ${fixture.FIXED.bodyNonce}` }, secrets: { bodyNonce: fixture.FIXED.bodyNonce } };
  configure(args, { fixture, parser });
  parser.assertSecretsAbsent(args.surfaces, args.secrets);
  return { accepted: true, code: "SECRETS_ACCEPTED" };
}

async function snapshotCase(configure = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n0-snapshot-pair."));
  fs.writeFileSync(path.join(root, "a.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "session" } })}\n`);
  const context = { args: { root, options: {} }, cleanup: [], restorers: [] };
  const patch = (object, key, replacement) => {
    const original = object[key];
    object[key] = replacement(original);
    context.restorers.push(() => { object[key] = original; });
  };
  try {
    configure(context, patch);
    const snapshot = await import("../n0-harness/snapshot.mjs");
    snapshot.snapshotTree(context.args.root, context.args.options);
    return { accepted: true, code: "SNAPSHOT_ACCEPTED" };
  } finally {
    for (const restore of context.restorers.reverse()) restore();
    for (const extra of context.cleanup.reverse()) fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function snapshotPair() {
  const entry = { path: "a.jsonl", dev: 1, ino: 2, size: 10, mtimeMs: 3, firstRecordType: "session_meta" };
  return {
    before: { schema: "N0_ROLLOUT_SNAPSHOT_V1", root: "/rollouts", totalBytes: 10, entries: [{ ...entry }] },
    after: { schema: "N0_ROLLOUT_SNAPSHOT_V1", root: "/rollouts", totalBytes: 10, entries: [{ ...entry }] },
  };
}

async function snapshotDiffCase(configure = () => {}, stable = false) {
  const snapshot = await import("../n0-harness/snapshot.mjs");
  const pair = snapshotPair();
  configure(pair);
  if (stable) snapshot.assertSnapshotStable(pair.before, pair.after);
  else snapshot.changedCandidates(pair.before, pair.after);
  return { accepted: true, code: stable ? "SNAPSHOT_STABLE_ACCEPTED" : "SNAPSHOT_DIFF_ACCEPTED" };
}

async function promptCase(configure = () => {}, digest = false) {
  const { fixture } = await parserModules();
  const prompt = await import("../n0-harness/prompt.mjs");
  const args = { specimen: fixture.fixtureSpecimen(), caseName: "N0a-M" };
  configure(args, { fixture, prompt });
  if (digest) prompt.promptDigest(args.specimen, args.caseName);
  else prompt.renderPrompt(args.specimen, args.caseName);
  return { accepted: true, code: digest ? "PROMPT_DIGEST_ACCEPTED" : "PROMPT_ACCEPTED" };
}

async function cliCase(configure = () => {}) {
  const { fixture } = await parserModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n0-cli-pair."));
  try {
    const specimen = fixture.fixtureSpecimen();
    const evidence = fixture.fixtureEvidence(specimen, NOW);
    fs.writeFileSync(path.join(root, "specimen.json"), JSON.stringify(specimen));
    fs.writeFileSync(path.join(root, "evidence.json"), JSON.stringify(evidence));
    const context = {
      root,
      specimen,
      evidence,
      argv: ["oracle", "--root", root, "--specimen", path.join(root, "specimen.json"), "--evidence", path.join(root, "evidence.json"), "--now-ms", String(NOW)],
    };
    configure(context, { fixture });
    const cli = fileURLToPath(new URL("../n0-harness/cli.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [cli, ...context.argv], { cwd: root, encoding: "utf8" });
    return { accepted: result.status === 0, code: result.status === 0 ? "CLI_ACCEPTED" : `CLI_EXIT_${result.status}` };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function specimenCase(kind) {
  const { fixture } = await parserModules();
  const specimenModule = await import("../n0-harness/specimen.mjs");
  if (kind === "build") {
    const input = fixture.fixtureSpecimen();
    input.target.clean = false;
    specimenModule.buildSpecimen(input);
    return { accepted: true, code: "BUILD_SPECIMEN_ACCEPTED" };
  }
  if (kind === "mail") {
    specimenModule.buildMailFixtureRequest({ bodyNonce: "g".repeat(32) });
    return { accepted: true, code: "MAIL_REQUEST_ACCEPTED" };
  }
  specimenModule.buildMailCleanupRequest({ rowId: 1.5 });
  return { accepted: true, code: "MAIL_CLEANUP_ACCEPTED" };
}

function patchLstatCall(callIndex, overrides) {
  return (original) => {
    let calls = 0;
    return function patchedLstat(...args) {
      const stat = original.apply(this, args);
      calls += 1;
      return calls === callIndex ? shadowStat(stat, overrides(stat)) : stat;
    };
  };
}

function patchFstat(mode, field) {
  return (original) => {
    let calls = 0;
    return function patchedFstat(...args) {
      const stat = original.apply(this, args);
      calls += 1;
      const alter = mode === "both" || (mode === "after" && calls === 2);
      return alter ? shadowStat(stat, { [field]: stat[field] + 1 }) : stat;
    };
  };
}

async function manifestContext() {
  const [{ fixtureSpecimen }, lib, oracle, prompt, evidenceManifest] = await Promise.all([
    import("../n0-harness/fixture.mjs"),
    import("../n0-harness/lib.mjs"),
    import("../n0-harness/oracle.mjs"),
    import("../n0-harness/prompt.mjs"),
    import("../n0-harness/evidence-manifest.mjs"),
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n0-manifest-pair."));
  fs.writeFileSync(path.join(root, "a.json"), "{}\n");
  fs.writeFileSync(path.join(root, "b.json"), "{}\n");
  const specimen = fixtureSpecimen();
  specimen.paths.control = root;
  for (const name of ["control-read", "control-chmod", "control-create"]) specimen.canaries[name].path = path.join(root, name);
  rebuildPrompts(specimen, { requiredCaseNames: oracle.requiredCaseNames, renderPrompt: prompt.renderPrompt, sha256: lib.sha256 });
  return { root, specimen, ...evidenceManifest };
}

async function buildManifestCase(mutate) {
  const context = await manifestContext();
  try {
    const args = { root: context.root, specimen: context.specimen, files: ["a.json"], createdAt: "2026-07-30T23:11:00.000Z" };
    mutate(args, context);
    context.buildEvidenceManifest(args);
    return { accepted: true, code: "BUILD_MANIFEST_ACCEPTED" };
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
}

async function validateManifestCase(mutate) {
  const context = await manifestContext();
  try {
    const manifest = context.buildEvidenceManifest({ root: context.root, specimen: context.specimen, files: ["a.json"], createdAt: "2026-07-30T23:11:00.000Z" });
    const mutated = mutate(manifest, context);
    const candidate = mutated === undefined ? manifest : mutated;
    context.validateEvidenceManifest(context.specimen, candidate);
    return { accepted: true, code: "VALIDATE_MANIFEST_ACCEPTED" };
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
}

const cases = {
  "lib.fail": () => libCase("fail", ["X", "x"]),
  "lib.object.null": () => libCase("requireObject", [null, "X", "value"]),
  "lib.object.string": () => libCase("requireObject", ["x", "X", "value"]),
  "lib.object.array": () => libCase("requireObject", [[], "X", "value"]),
  "lib.string.type": () => libCase("requireString", [7, "X", "value"]),
  "lib.string.short": () => libCase("requireString", ["", "X", "value"]),
  "lib.string.long": () => libCase("requireString", ["xx", "X", "value", { max: 1 }]),
  "lib.integer.type": () => libCase("requireSafeInteger", [1.5, "X", "value"]),
  "lib.integer.min": () => libCase("requireSafeInteger", [0, "X", "value"]),
  "lib.sha.format": () => libCase("requireSha256", ["g".repeat(64), "X", "value"]),
  "lib.sha.length": () => libCase("requireSha256", ["short", "X", "value"]),
  "lib.commit.format": () => libCase("requireGitCommit", ["g".repeat(40), "X", "value"]),
  "lib.commit.length": () => libCase("requireGitCommit", ["short", "X", "value"]),
  "lib.nonce.format": () => libCase("requireNonce", ["g".repeat(32), "X", "value"]),
  "lib.nonce.length": () => libCase("requireNonce", ["short", "X", "value"]),
  "lib.exact-keys.object": () => libCase("assertExactKeys", [null, [], "X", "value"]),
  "lib.exact-keys.extra": () => libCase("assertExactKeys", [{ extra: true }, [], "X", "value"]),
  "lib.path.outside": () => libCase("requirePathInside", ["/root/base", "/root/outside", "X"]),
  "lib.path.parent": () => libCase("requirePathInside", ["/root/base", "/root", "X"]),
  "lib.read.root-directory": () => readFileCase((context, patch) => {
    patch(fs, "lstatSync", patchLstatCall(1, () => ({ isDirectory: () => false })));
  }),
  "lib.read.root-owner": () => readFileCase((context, patch) => {
    patch(fs, "lstatSync", patchLstatCall(1, (stat) => ({ uid: stat.uid + 1 })));
  }),
  "lib.read.lexical-alias": () => readFileCase((context) => {
    const alias = `${context.args.root}.alias`;
    fs.symlinkSync(context.args.root, alias, "dir");
    context.cleanup.push(alias);
    context.args.target = path.join(alias, "a.json");
  }),
  "lib.read.file-symlink": () => readFileCase((context) => {
    const link = path.join(context.args.root, "link.json");
    fs.symlinkSync(context.args.target, link, "file");
    context.args.target = link;
  }),
  "lib.read.file-regular": () => readFileCase((context, patch) => {
    patch(fs, "lstatSync", patchLstatCall(2, () => ({ isFile: () => false, isSymbolicLink: () => false })));
  }),
  "lib.read.file-owner": () => readFileCase((context, patch) => {
    patch(fs, "lstatSync", patchLstatCall(3, (stat) => ({ uid: stat.uid + 1 })));
  }),
  "lib.read.file-size": () => readFileCase((context) => { context.args.options.maxBytes = 0; }),
  "lib.read.realpath-alias": () => readFileCase((context) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "n0-read-outside."));
    fs.writeFileSync(path.join(outside, "a.json"), "{}\n");
    fs.symlinkSync(outside, path.join(context.args.root, "escape"), "dir");
    context.cleanup.push(outside);
    context.args.target = path.join(context.args.root, "escape", "a.json");
  }),
  "lib.read.before-dev": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "dev")); }),
  "lib.read.before-ino": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "ino")); }),
  "lib.read.before-size": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "size")); }),
  "lib.read.before-mtime": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "mtimeMs")); }),
  "lib.read.after-dev": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "dev")); }),
  "lib.read.after-ino": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "ino")); }),
  "lib.read.after-size": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "size")); }),
  "lib.read.after-mtime": () => readFileCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "mtimeMs")); }),
  "lib.json.invalid": () => libCase("parseJsonBuffer", [Buffer.from("{")]),
  "parser.rollout.type-buffer": async () => {
    const { fixture } = await parserModules();
    const input = Buffer.from(fixture.fixtureRollout());
    input.split = (...args) => input.toString("utf8").split(...args);
    return parseRolloutCase(input);
  },
  "parser.rollout.too-large": async () => {
    const { lib } = await parserModules();
    return parseRolloutCase(`${JSON.stringify({ type: "session_meta", payload: { id: "x".repeat(lib.MAX_JSON_BYTES) } })}\n`);
  },
  "parser.rollout.too-many": async () => {
    const { lib } = await parserModules();
    const lines = [JSON.stringify({ type: "session_meta", payload: { id: "session" } })];
    while (lines.length <= lib.MAX_RECORDS) lines.push("{}");
    return parseRolloutCase(`${lines.join("\n")}\n`);
  },
  "parser.rollout.invalid-json-late": () => parseRolloutCase(`${JSON.stringify({ type: "session_meta", payload: { id: "session" } })}\n{\n`),
  "parser.rollout.session-type": () => parseRolloutCase(`${JSON.stringify({ type: "wrong", payload: { id: "session" } })}\n`),
  "parser.rollout.session-id-type": () => parseRolloutCase(`${JSON.stringify({ type: "session_meta", payload: { id: 7 } })}\n`),
  "parser.rollout.session-id-empty": () => parseRolloutCase(`${JSON.stringify({ type: "session_meta", payload: { id: "" } })}\n`),
  "parser.nonce.invalid": () => nonceCase((args) => {
    args.nonce = "g".repeat(32);
    args.records[1].payload.content[0].text = "a".repeat(32);
  }),
  "parser.nonce.total": () => nonceCase((args) => { args.records[1].payload.content[0].text = `${args.nonce} ${args.nonce}`; }),
  "parser.nonce.turn": () => nonceCase((args) => { args.options.expectedTurnId = "wrong-turn"; }),
  "parser.nonce.task": () => nonceCase((args) => { args.options.expectedTaskId = "wrong-task"; }),
  "parser.nonce.run": () => nonceCase((args) => { args.options.expectedRunId = "wrong-run"; }),
  "parser.marker.nonce-invalid": () => markerCase((args, { fixture }) => {
    args.markerNonce = "g".repeat(32);
    args.candidates[0].text = fixture.fixtureRollout({ nonce: "a".repeat(32) });
  }),
  "parser.marker.rollout-type": () => markerCase((args) => { args.candidates[0].text = Buffer.from(args.candidates[0].text); }),
  "parser.marker.span": () => markerCase((args, { fixture }) => { args.candidates[0].text = fixture.fixtureRollout({ userText: "marker absent" }); }),
  "parser.marker.unexpected-error": () => markerCase((args, { fixture }) => {
    args.candidates = [{ path: "bad.jsonl", text: "{\n" }, { path: "good.jsonl", text: fixture.fixtureRollout({ nonce: fixture.FIXED.markerNonce }) }];
  }),
  "parser.marker.zero": () => markerCase((args) => { args.candidates = []; }),
  "parser.marker.multiple": () => markerCase((args, { fixture }) => {
    args.candidates.push({ path: "b.jsonl", text: fixture.fixtureRollout({ nonce: fixture.FIXED.markerNonce }) });
  }),
  "parser.scheduled.rollout-type": () => scheduledCase((args) => { args.rolloutText = Buffer.from(args.rolloutText); }),
  "parser.scheduled.run-record-object": () => scheduledCase((args) => { args.runRecord = JSON.stringify(args.runRecord); }),
  "parser.scheduled.chat": () => scheduledCase((args) => { args.expected.sessionId = "wrong-session"; }),
  "parser.scheduled.run-record-type": () => scheduledCase((args) => { args.runRecord.taskId = 7; }),
  "parser.scheduled.task": () => scheduledCase((args) => { args.runRecord.taskId = "wrong-task"; }),
  "parser.scheduled.run": () => scheduledCase((args) => { args.runRecord.runId = "wrong-run"; }),
  "parser.scheduled.turn": () => scheduledCase((args) => { args.runRecord.turnId = "wrong-turn"; }),
  "parser.scheduled.nonce": () => scheduledCase((args, { fixture }) => { args.rolloutText = fixture.fixtureRollout({ userText: "nonce absent", environment: args.expected.environment }); }),
  "parser.scheduled.context-missing": () => scheduledCase((args) => {
    const records = args.rolloutText.trimEnd().split("\n").map((line) => JSON.parse(line)).filter((record) => record.type !== "turn_context");
    args.rolloutText = `${records.map(JSON.stringify).join("\n")}\n`;
  }),
  "parser.scheduled.context-duplicate": () => scheduledCase((args, { fixture }) => {
    args.rolloutText = fixture.fixtureRollout({ environment: args.expected.environment, extraRecords: [{ type: "turn_context", payload: { turn_id: args.expected.turnId, ...args.expected.environment } }] });
  }),
  "parser.scheduled.environment": () => scheduledCase((args) => { args.expected.environment.model = "wrong-model"; }),
  "parser.scheduled.steer-method": () => scheduledCase((args, { fixture }) => {
    args.rolloutText = fixture.fixtureRollout({ environment: args.expected.environment, extraRecords: [{ type: "event_msg", payload: { method: "turn/steer" } }] });
  }),
  "parser.scheduled.steer-type-underscore": () => scheduledCase((args, { fixture }) => {
    args.rolloutText = fixture.fixtureRollout({ environment: args.expected.environment, extraRecords: [{ type: "turn_steered" }] });
  }),
  "parser.scheduled.steer-type-slash": () => scheduledCase((args, { fixture }) => {
    args.rolloutText = fixture.fixtureRollout({ environment: args.expected.environment, extraRecords: [{ type: "turn/steer" }] });
  }),
  "parser.scheduled.steer-nested": () => scheduledCase((args, { fixture }) => {
    args.rolloutText = fixture.fixtureRollout({ environment: args.expected.environment, extraRecords: [{ type: "event_msg", payload: { nested: { method: "turn/steer" } } }] });
  }),
  "parser.pointer.id": () => pointerCase((args) => { args.expectedId = 1.5; }),
  "parser.pointer.raw-type": () => pointerCase((args) => { args.raw = new String(args.raw); }),
  "parser.pointer.byte-limit": () => pointerCase((args, { fixture, lib }) => {
    args.raw = fixture.fixtureKijitoGet({ body: "é".repeat(Math.floor(lib.MAX_JSON_BYTES * 0.6)) });
  }),
  "parser.pointer.unclosed": () => pointerCase((args) => { args.raw = args.raw.replace(/⟦\/UNTRUSTED n=a1b2c3⟧$/, ""); }),
  "parser.pointer.multiple": () => pointerCase((args, { fixture }) => {
    const second = fixture.fixtureKijitoGet({ body: "SECOND", outerNonce: "face999" }).split("\n").slice(6).join("\n");
    args.raw = `${args.raw}\n${second}`;
  }),
  "parser.pointer.trailing": () => pointerCase((args) => { args.raw = `${args.raw}\nTRAILING`; }),
  "parser.pointer.header": () => pointerCase((args) => { args.raw = args.raw.replace(/^Memory \[21813\]/, "Memory [999]"); }),
  "parser.mail.row": () => mailCase((args) => { args.options.rowId = 1.5; }),
  "parser.mail.nonce": () => mailCase((args, { fixture }) => {
    args.options.bodyNonce = "g".repeat(32);
    args.records.at(-1).payload.result.content[0].text = args.records.at(-1).payload.result.content[0].text.replace(fixture.FIXED.bodyNonce, "a".repeat(32));
  }),
  "parser.mail.zero": () => mailCase((args) => { args.records = args.records.filter((record) => record.payload?.invocation?.tool !== "kijito_hive_inbox"); }),
  "parser.secret.leak": () => secretCase(),
  "snapshot.read.before-dev": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "dev")); }),
  "snapshot.read.before-ino": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "ino")); }),
  "snapshot.read.before-size": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "size")); }),
  "snapshot.read.before-mtime": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("both", "mtimeMs")); }),
  "snapshot.read.after-dev": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "dev")); }),
  "snapshot.read.after-ino": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "ino")); }),
  "snapshot.read.after-size": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "size")); }),
  "snapshot.read.after-mtime": () => snapshotCase((context, patch) => { patch(fs, "fstatSync", patchFstat("after", "mtimeMs")); }),
  "snapshot.root.directory": () => snapshotCase((context, patch) => { patch(fs, "lstatSync", patchLstatCall(1, () => ({ isDirectory: () => false }))); }),
  "snapshot.root.owner": () => snapshotCase((context, patch) => { patch(fs, "lstatSync", patchLstatCall(1, (stat) => ({ uid: stat.uid + 1 }))); }),
  "snapshot.entry.symlink": () => snapshotCase((context) => { fs.symlinkSync(path.join(context.args.root, "a.jsonl"), path.join(context.args.root, "link.jsonl"), "file"); }),
  "snapshot.entry.realpath": () => snapshotCase((context) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "n0-snapshot-outside."));
    fs.writeFileSync(path.join(outside, "outside.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "outside" } })}\n`);
    fs.symlinkSync(path.join(outside, "outside.jsonl"), path.join(context.args.root, "escape.jsonl"), "file");
    context.cleanup.push(outside);
  }),
  "snapshot.entry.owner": () => snapshotCase((context, patch) => { patch(fs, "lstatSync", patchLstatCall(3, (stat) => ({ uid: stat.uid + 1 }))); }),
  "snapshot.entry.nonregular": () => snapshotCase((context, patch) => {
    patch(fs, "lstatSync", patchLstatCall(3, () => ({ isDirectory: () => false, isFile: () => false })));
  }),
  "snapshot.entry.child-walk": () => snapshotCase((context) => {
    const child = path.join(context.args.root, "child");
    fs.mkdirSync(child);
    fs.symlinkSync(path.join(context.args.root, "a.jsonl"), path.join(child, "link.jsonl"), "file");
  }),
  "snapshot.entry.file-limit": () => snapshotCase((context) => { context.args.options.maxFiles = 0; }),
  "snapshot.entry.byte-limit": () => snapshotCase((context) => { context.args.options.maxTotalBytes = 0; }),
  "snapshot.root.walk": () => snapshotCase((context) => { fs.symlinkSync(path.join(context.args.root, "a.jsonl"), path.join(context.args.root, "link.jsonl"), "file"); }),
  "snapshot.diff.before-schema": () => snapshotDiffCase((pair) => { pair.before.schema = "WRONG"; }),
  "snapshot.diff.after-schema": () => snapshotDiffCase((pair) => { pair.after.schema = "WRONG"; }),
  "snapshot.diff.root": () => snapshotDiffCase((pair) => { pair.after.root = "/other"; }),
  "snapshot.diff.removed": () => snapshotDiffCase((pair) => { pair.after.entries = []; }),
  "snapshot.diff.dev": () => snapshotDiffCase((pair) => { pair.after.entries[0].dev += 1; }),
  "snapshot.diff.ino": () => snapshotDiffCase((pair) => { pair.after.entries[0].ino += 1; }),
  "snapshot.diff.truncated": () => snapshotDiffCase((pair) => { pair.after.entries[0].size -= 1; }),
  "snapshot.stable.changed": () => snapshotDiffCase((pair) => { pair.after.entries[0].size += 1; }, true),
  "snapshot.stable.error": () => snapshotDiffCase((pair) => { pair.before.schema = "WRONG"; }, true),
  "prompt.unknown": () => promptCase((args) => { args.caseName = "UNKNOWN"; }),
  "prompt.nonce": () => promptCase((args) => { args.specimen.cases[args.caseName].nonce = "g".repeat(32); }),
  "prompt.mail-row": () => promptCase((args) => { args.caseName = "N0a-K"; args.specimen.cases[args.caseName].mailRowId = 1.5; }),
  "prompt.digest": () => promptCase((args) => { args.specimen.cases[args.caseName].nonce = "g".repeat(32); }, true),
  "cli.usage.unknown": () => cliCase((context) => { context.argv = ["unknown", "--root", context.root]; }),
  "cli.args.dangling": () => cliCase((context) => { context.argv = ["snapshot", "--root", context.root, "--dangling"]; }),
  "cli.args.key": () => cliCase((context) => { context.argv = ["snapshot", "xxroot", context.root]; }),
  "cli.args.missing-specimen": () => cliCase((context) => { context.argv.splice(3, 2); }),
  "cli.args.missing-evidence": () => cliCase((context) => { context.argv.splice(5, 2); }),
  "cli.args.missing-inputs": () => cliCase((context) => {
    context.argv = ["oracle", "--root", context.root, "--now-ms", String(NOW)];
  }),
  "cli.root.relative": () => cliCase((context) => { context.argv = ["snapshot", "--root", "."]; }),
  "cli.snapshot.symlink": () => cliCase((context) => {
    fs.symlinkSync(path.join(context.root, "specimen.json"), path.join(context.root, "link.json"), "file");
    context.argv = ["snapshot", "--root", context.root];
  }),
  "cli.specimen.read": () => cliCase((context) => { context.argv[4] = path.join(context.root, "..", "outside.json"); }),
  "cli.evidence.read": () => cliCase((context) => { context.argv[6] = path.join(context.root, "..", "outside.json"); }),
  "cli.specimen.parse": () => cliCase((context) => {
    fs.copyFileSync(path.join(context.root, "specimen.json"), path.join(context.root, "specimen-valid.json"));
    fs.writeFileSync(path.join(context.root, "specimen.json"), "{");
  }),
  "cli.evidence.parse": () => cliCase((context) => {
    fs.copyFileSync(path.join(context.root, "evidence.json"), path.join(context.root, "evidence-valid.json"));
    fs.writeFileSync(path.join(context.root, "evidence.json"), "{");
  }),
  "cli.oracle.red": () => cliCase((context) => {
    context.evidence.probeId = "2".repeat(32);
    fs.writeFileSync(path.join(context.root, "evidence.json"), JSON.stringify(context.evidence));
  }),
  "specimen.build.invalid": () => specimenCase("build"),
  "specimen.mail.nonce": () => specimenCase("mail"),
  "specimen.mail.row": () => specimenCase("cleanup"),
  "oracle.specimen.keys": () => validationNoRebuildCase((specimen) => { specimen.extra = true; }),
  "oracle.specimen.schema": () => validationNoRebuildCase((specimen) => { specimen.schema = "WRONG"; }),
  "oracle.specimen.probe-format": () => validationNoRebuildCase((specimen) => { specimen.probeId = "g".repeat(32); }),
  "oracle.specimen.provenance-object": () => validationNoRebuildCase((specimen) => { specimen.protocol = JSON.stringify(specimen.protocol); }),
  "oracle.specimen.provenance-extra": () => validationNoRebuildCase((specimen) => { specimen.protocol.extra = true; }),
  "oracle.specimen.commit-format": () => validationNoRebuildCase((specimen) => { specimen.protocol.commit = new String(specimen.protocol.commit); }),
  "oracle.specimen.digest-format": () => validationNoRebuildCase((specimen) => { specimen.protocol.digest = new String(specimen.protocol.digest); }),
  "oracle.specimen.protocol-commit": () => validationCase((specimen) => { specimen.protocol.commit = "f".repeat(40); }),
  "oracle.specimen.protocol-digest": () => validationCase((specimen) => { specimen.protocol.digest = "f".repeat(64); }),
  "oracle.specimen.harness-digest": () => validationCase((specimen) => { specimen.harness.digest = "f".repeat(64); }),
  "oracle.specimen.paths-object": () => validationNoRebuildCase((specimen) => { specimen.paths = JSON.stringify(specimen.paths); }),
  "oracle.specimen.paths-extra": () => validationNoRebuildCase((specimen) => { specimen.paths.extra = true; }),
  "oracle.specimen.path-type": () => validationNoRebuildCase((specimen) => {
    const original = specimen.paths.ordinaryAuth;
    specimen.paths.ordinaryAuth = { toString: () => original };
  }),
  "oracle.specimen.path-relative": () => validationNoRebuildCase((specimen) => { specimen.paths.ordinaryAuth = "relative-auth"; }),
  "oracle.specimen.project-equal-parent": () => validationCase((specimen) => {
    specimen.paths.project = specimen.paths.specimenParent;
    specimen.target.path = specimen.paths.project;
    Object.assign(specimen.environment, { cwd: specimen.paths.project, project: specimen.paths.project, worktree: specimen.paths.project, workspace_roots: [specimen.paths.project] });
    specimen.environment.permission_profile.file_system.writable_roots = [specimen.paths.project];
    specimen.canaries["cwd-create"].path = `${specimen.paths.project}/cwd`;
  }),
  "oracle.specimen.project-outside-parent": () => validationCase((specimen) => {
    specimen.paths.project = "/Users/jason/Outside/project";
    specimen.target.path = specimen.paths.project;
    Object.assign(specimen.environment, { cwd: specimen.paths.project, project: specimen.paths.project, worktree: specimen.paths.project, workspace_roots: [specimen.paths.project] });
    specimen.environment.permission_profile.file_system.writable_roots = [specimen.paths.project];
    specimen.canaries["cwd-create"].path = `${specimen.paths.project}/cwd`;
  }),
  "oracle.specimen.outside-inside-project": () => validationCase((specimen) => {
    specimen.paths.control = `${specimen.paths.project}/control`;
    for (const name of ["control-read", "control-chmod", "control-create"]) specimen.canaries[name].path = `${specimen.paths.control}/${name}`;
  }),
  "oracle.specimen.outside-contains-project": () => validationCase((specimen) => {
    specimen.paths.control = specimen.paths.specimenParent;
    for (const name of ["control-read", "control-chmod", "control-create"]) specimen.canaries[name].path = `${specimen.paths.control}/${name}`;
  }),
  "oracle.specimen.slash-tmp": () => validationCase((specimen) => {
    specimen.paths.slashTmp = "/var/tmp";
    specimen.canaries["slash-tmp-create"].path = "/var/tmp/canary";
  }),
  "oracle.specimen.target-object": () => validationNoRebuildCase((specimen) => { specimen.target = JSON.stringify(specimen.target); }),
  "oracle.specimen.target-extra": () => validationNoRebuildCase((specimen) => { specimen.target.extra = true; }),
  "oracle.specimen.target-path": () => validationCase((specimen) => { specimen.target.path = `${specimen.paths.project}/wrong`; }),
  "oracle.specimen.target-device": () => validationNoRebuildCase((specimen) => { specimen.target.device = new Number(specimen.target.device); }),
  "oracle.specimen.target-inode": () => validationNoRebuildCase((specimen) => { specimen.target.inode = new Number(specimen.target.inode); }),
  "oracle.specimen.target-commit-format": () => validationNoRebuildCase((specimen) => { specimen.target.gitHead = new String(specimen.target.gitHead); }),
  "oracle.specimen.target-head": () => validationCase((specimen) => { specimen.target.gitHead = "f".repeat(40); }),
  "oracle.specimen.permission-object": () => validationNoRebuildCase((specimen) => { specimen.permission = JSON.stringify(specimen.permission); }),
  "oracle.specimen.permission-extra": () => validationNoRebuildCase((specimen) => { specimen.permission.extra = true; }),
  "oracle.specimen.permission-profile": () => validationCase((specimen) => {
    specimen.permission.profile = "wrong";
    specimen.environment.sandbox_policy.name = "wrong";
    specimen.environment.permission_profile.name = "wrong";
  }),
  "oracle.specimen.config-type": () => validationNoRebuildCase((specimen) => { specimen.permission.configUtf8 = new String(specimen.permission.configUtf8); }),
  "oracle.specimen.config-digest-type": () => validationNoRebuildCase((specimen) => { specimen.permission.configDigest = new String(specimen.permission.configDigest); }),
  "oracle.specimen.config-reviewed": () => validationCase((specimen, { sha256 }) => {
    specimen.permission.configUtf8 = "changed";
    specimen.permission.configDigest = sha256(Buffer.from("changed"));
  }),
  "oracle.specimen.config-bytes": () => validationCase((specimen) => { specimen.permission.configUtf8 = "changed"; }),
  "oracle.specimen.extra-root": () => validationCase((specimen) => { specimen.permission.addedWorkspaceRoots = ["/tmp"]; }),
  "oracle.specimen.filesystem-extra": () => validationNoRebuildCase((specimen) => { specimen.permission.filesystem.extra = true; }),
  "oracle.specimen.tmpdir": () => validationCase((specimen) => { specimen.permission.filesystem[":tmpdir"] = "write"; }),
  "oracle.specimen.slash-tmp-deny": () => validationCase((specimen) => { specimen.permission.filesystem[":slash_tmp"] = "write"; }),
  "oracle.specimen.legacy": () => validationCase((specimen) => { specimen.permission.legacySandboxSettingsPresent = true; }),
  "oracle.specimen.environment-call": () => validationCase((specimen) => { specimen.environment.approval_policy = "ask"; }),
  "oracle.specimen.canaries-object": () => validationNoRebuildCase((specimen) => { specimen.canaries = JSON.stringify(specimen.canaries); }),
  "oracle.specimen.canary-set": () => validationCase((specimen) => { specimen.canaries.extra = { ...specimen.canaries["control-read"] }; }),
  "oracle.specimen.canary-locations": () => validationCase((specimen) => { specimen.canaries["control-read"].path = `${specimen.paths.project}/wrong`; }),
  "oracle.specimen.cases-object": () => validationNoRebuildCase((specimen) => { specimen.cases = JSON.stringify(specimen.cases); }),
  "oracle.specimen.case-set": () => validationCase((specimen) => { specimen.cases.extra = { ...specimen.cases["N0a-M"] }; }),
  "oracle.specimen.case-object": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-M"] = JSON.stringify(specimen.cases["N0a-M"]); }),
  "oracle.specimen.case-extra": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-M"].extra = true; }),
  "oracle.specimen.case-nonce-format": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-M"].nonce = new String(specimen.cases["N0a-M"].nonce); }),
  "oracle.specimen.case-nonce-reuse": () => validationCase((specimen) => { specimen.cases["N0a-W"].nonce = specimen.cases["N0a-M"].nonce; }),
  "oracle.specimen.case-policy": () => validationCase((specimen) => { specimen.cases["N0a-M"].scheduled = true; }),
  "oracle.specimen.case-boundary-format": () => validationCase((specimen) => { specimen.cases["N0a-M"].intendedBoundary = "invalid"; }),
  "oracle.specimen.case-boundary-order": () => validationCase((specimen) => { specimen.cases["N0a-W"].intendedBoundary = specimen.cases["N0a-M"].intendedBoundary; }),
  "oracle.specimen.expected-object": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-M"].expected = JSON.stringify(specimen.cases["N0a-M"].expected); }),
  "oracle.specimen.expected-extra": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-M"].expected.extra = true; }),
  "oracle.specimen.chat-type": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-M"].expected.chatSessionId = new String(specimen.cases["N0a-M"].expected.chatSessionId); }),
  "oracle.specimen.expected-key-type": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-W"].expected.taskId = new String(specimen.cases["N0a-W"].expected.taskId); }),
  "oracle.specimen.expected-reuse": () => validationCase((specimen) => { specimen.cases["N0a-B"].expected.taskId = specimen.cases["N0a-W"].expected.taskId; }),
  "oracle.specimen.expected-nonbinding": () => validationCase((specimen) => { specimen.cases["N0a-M"].expected.taskId = "unexpected"; }),
  "oracle.specimen.case-mail-type": () => validationNoRebuildCase((specimen) => { specimen.cases["N0a-K"].mailRowId = new Number(77); }),
  "oracle.specimen.case-mail-other": () => validationCase((specimen) => { specimen.cases["N0a-M"].mailRowId = 77; }),
  "oracle.specimen.chat-targets": () => validationCase((specimen) => { specimen.cases["N0a-W"].expected.chatSessionId = "other-session"; }),
  "oracle.specimen.prompts-object": () => validationNoRebuildCase((specimen) => { specimen.prompts = JSON.stringify(specimen.prompts); }),
  "oracle.specimen.prompt-set": () => validationNoRebuildCase((specimen) => { specimen.prompts.extra = { ...specimen.prompts["N0a-M"] }; }),
  "oracle.specimen.prompt-object": () => validationNoRebuildCase((specimen) => { specimen.prompts["N0a-M"] = JSON.stringify(specimen.prompts["N0a-M"]); }),
  "oracle.specimen.prompt-extra": () => validationNoRebuildCase((specimen) => { specimen.prompts["N0a-M"].extra = true; }),
  "oracle.specimen.prompt-type": () => validationNoRebuildCase((specimen) => { specimen.prompts["N0a-M"].utf8 = new String(specimen.prompts["N0a-M"].utf8); }),
  "oracle.specimen.prompt-sha-type": () => validationNoRebuildCase((specimen) => { specimen.prompts["N0a-M"].sha256 = new String(specimen.prompts["N0a-M"].sha256); }),
  "oracle.specimen.prompt-digest": () => validationNoRebuildCase((specimen) => { specimen.prompts["N0a-M"].sha256 = "f".repeat(64); }),
  "oracle.specimen.prompt-bytes": () => validationNoRebuildCase((specimen) => {
    specimen.prompts["N0a-M"].utf8 = "changed";
    specimen.prompts["N0a-M"].sha256 = "d67e2e944994496c8d8ec76eed0cf9f09679448d584b532bebf941852a37f5ed";
  }),
  "oracle.specimen.clock-object": () => validationNoRebuildCase((specimen) => { specimen.clock = JSON.stringify(specimen.clock); }),
  "oracle.specimen.clock-extra": () => validationNoRebuildCase((specimen) => { specimen.clock.extra = true; }),
  "oracle.specimen.clock-time": () => validationNoRebuildCase((specimen) => { specimen.clock.intendedMinuteBoundary = "invalid"; }),
  "oracle.specimen.clock-skew": () => validationNoRebuildCase((specimen) => { specimen.clock.maxSkewSeconds = 16; }),
  "oracle.specimen.clock-heartbeat": () => validationNoRebuildCase((specimen) => { specimen.clock.maxHeartbeatAgeSeconds = 136; }),
  "oracle.specimen.rollout-call": () => validationNoRebuildCase((specimen) => { specimen.rollout.root = "relative"; }),
  "oracle.specimen.versions-call": () => validationNoRebuildCase((specimen) => { specimen.versions.codexCli = 7; }),
  "oracle.specimen.created-at": () => validationNoRebuildCase((specimen) => { specimen.createdAt = "invalid"; }),
  "oracle.rollout.object": () => validationNoRebuildCase((specimen) => { specimen.rollout = JSON.stringify(specimen.rollout); }),
  "oracle.rollout.extra": () => validationNoRebuildCase((specimen) => { specimen.rollout.extra = true; }),
  "oracle.rollout.root-type": () => validationNoRebuildCase((specimen) => { specimen.rollout.root = new String(specimen.rollout.root); }),
  "oracle.rollout.root-relative": () => validationNoRebuildCase((specimen) => {
    specimen.rollout.root = "relative";
    specimen.rollout.preActionSnapshot.root = "relative";
  }),
  "oracle.rollout.snapshot-object": () => validationNoRebuildCase((specimen) => { specimen.rollout.preActionSnapshot = JSON.stringify(specimen.rollout.preActionSnapshot); }),
  "oracle.rollout.snapshot-extra": () => validationNoRebuildCase((specimen) => { specimen.rollout.preActionSnapshot.extra = true; }),
  "oracle.rollout.snapshot-schema": () => validationNoRebuildCase((specimen) => { specimen.rollout.preActionSnapshot.schema = "WRONG"; }),
  "oracle.rollout.snapshot-root": () => validationNoRebuildCase((specimen) => { specimen.rollout.preActionSnapshot.root = "/wrong"; }),
  "oracle.rollout.total-type": () => validationNoRebuildCase((specimen) => { specimen.rollout.preActionSnapshot.totalBytes = new Number(0); }),
  "oracle.rollout.entries-arraylike": () => validationNoRebuildCase((specimen) => {
    specimen.rollout.preActionSnapshot.entries = { length: 0, entries: Array.prototype.entries };
  }),
  "oracle.rollout.entry-object": () => validationNoRebuildCase((specimen) => {
    const entry = addRolloutEntry(specimen);
    specimen.rollout.preActionSnapshot.entries[0] = JSON.stringify(entry);
  }),
  "oracle.rollout.entry-extra": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).extra = true; }),
  "oracle.rollout.entry-path-type": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).path = new String("session.jsonl"); }),
  "oracle.rollout.entry-path-absolute": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).path = "/session.jsonl"; }),
  "oracle.rollout.entry-path-parent": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).path = ".."; }),
  "oracle.rollout.entry-path-prefix": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).path = `..${path.sep}session.jsonl`; }),
  "oracle.rollout.entry-duplicate": () => validationNoRebuildCase((specimen) => {
    const entry = addRolloutEntry(specimen);
    specimen.rollout.preActionSnapshot.entries.push({ ...entry });
    specimen.rollout.preActionSnapshot.totalBytes *= 2;
  }),
  "oracle.rollout.entry-dev": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).dev = new Number(1); }),
  "oracle.rollout.entry-ino": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).ino = new Number(2); }),
  "oracle.rollout.entry-size": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).size = new Number(10); }),
  "oracle.rollout.entry-mtime-finite": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).mtimeMs = Number.NaN; }),
  "oracle.rollout.entry-mtime-negative": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).mtimeMs = -1; }),
  "oracle.rollout.entry-record-type": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen).firstRecordType = new String("session_meta"); }),
  "oracle.rollout.total-mismatch": () => validationNoRebuildCase((specimen) => { addRolloutEntry(specimen); specimen.rollout.preActionSnapshot.totalBytes = 11; }),
  "oracle.rollout.parser-object": () => validationNoRebuildCase((specimen) => { specimen.rollout.parser = JSON.stringify(specimen.rollout.parser); }),
  "oracle.rollout.parser-extra": () => validationNoRebuildCase((specimen) => { specimen.rollout.parser.extra = true; }),
  "oracle.rollout.parser-version": () => validationNoRebuildCase((specimen) => { specimen.rollout.parser.version = "WRONG"; }),
  "oracle.rollout.parser-digest-type": () => validationNoRebuildCase((specimen) => { specimen.rollout.parser.digest = new String(specimen.rollout.parser.digest); }),
  "oracle.rollout.parser-digest": () => validationNoRebuildCase((specimen) => { specimen.rollout.parser.digest = "f".repeat(64); }),
  "oracle.versions.object": () => validationNoRebuildCase((specimen) => { specimen.versions = JSON.stringify(specimen.versions); }),
  "oracle.versions.extra": () => validationNoRebuildCase((specimen) => { specimen.versions.extra = true; }),
  "oracle.versions.string": () => validationNoRebuildCase((specimen) => { specimen.versions.codexCli = new String(specimen.versions.codexCli); }),
  "oracle.versions.digest": () => validationNoRebuildCase((specimen) => { specimen.versions.codexBinaryDigest = new String(specimen.versions.codexBinaryDigest); }),
  "oracle.canary.extra": () => validationNoRebuildCase((specimen) => { specimen.canaries["control-read"].extra = true; }),
  "oracle.canary.path-type": () => validationNoRebuildCase((specimen) => {
    specimen.canaries["control-read"].path = new String(specimen.canaries["control-read"].path);
  }),
  "oracle.canary.nonce-type": () => validationNoRebuildCase((specimen) => {
    specimen.canaries["control-read"].nonce = new String(specimen.canaries["control-read"].nonce);
  }),
  "oracle.canary.nonce-format": () => validationCase((specimen) => { specimen.canaries["control-read"].nonce = "g".repeat(32); }),
  "oracle.environment.object": () => validationNoRebuildCase((specimen) => { specimen.environment = JSON.stringify(specimen.environment); }),
  "oracle.environment.extra": () => validationNoRebuildCase((specimen) => { specimen.environment.extra = true; }),
  "oracle.environment.cwd": () => validationCase((specimen) => { specimen.environment.cwd = "/wrong"; }),
  "oracle.environment.project": () => validationCase((specimen) => { specimen.environment.project = "/wrong"; }),
  "oracle.environment.worktree": () => validationCase((specimen) => { specimen.environment.worktree = "/wrong"; }),
  "oracle.environment.roots": () => validationCase((specimen) => { specimen.environment.workspace_roots = ["/wrong"]; }),
  "oracle.environment.model": () => validationNoRebuildCase((specimen) => { specimen.environment.model = new String(specimen.environment.model); }),
  "oracle.environment.reasoning": () => validationNoRebuildCase((specimen) => { specimen.environment.reasoning = new String(specimen.environment.reasoning); }),
  "oracle.environment.approval": () => validationCase((specimen) => { specimen.environment.approval_policy = "ask"; }),
  "oracle.environment.sandbox-extra": () => validationNoRebuildCase((specimen) => { specimen.environment.sandbox_policy.extra = true; }),
  "oracle.environment.sandbox-type": () => validationCase((specimen) => { specimen.environment.sandbox_policy.type = "wrong"; }),
  "oracle.environment.sandbox-name": () => validationCase((specimen) => { specimen.environment.sandbox_policy.name = "wrong"; }),
  "oracle.environment.profile-extra": () => validationNoRebuildCase((specimen) => { specimen.environment.permission_profile.extra = true; }),
  "oracle.environment.filesystem-extra": () => validationNoRebuildCase((specimen) => { specimen.environment.permission_profile.file_system.extra = true; }),
  "oracle.environment.profile-name": () => validationCase((specimen) => { specimen.environment.permission_profile.name = "wrong"; }),
  "oracle.environment.writable": () => validationCase((specimen) => { specimen.environment.permission_profile.file_system.writable_roots = ["/wrong"]; }),
  "oracle.environment.denied": () => validationCase((specimen) => { specimen.environment.permission_profile.file_system.denied = []; }),
  "oracle.environment.network-extra": () => validationNoRebuildCase((specimen) => { specimen.environment.network.extra = true; }),
  "oracle.environment.network-default": () => validationCase((specimen) => { specimen.environment.network.default = "allow"; }),
  "oracle.environment.network-exceptions": () => validationCase((specimen) => { specimen.environment.network.exceptions = {}; }),
  "oracle.permission.specimen": () => permissionCase(({ specimen }) => { specimen.target.clean = false; }),
  "oracle.permission.object": () => permissionCase((context) => { context.evidence = JSON.stringify(context.evidence); }),
  "oracle.permission.extra": () => permissionCase(({ evidence }) => { evidence.extra = true; }),
  "oracle.permission.profile": () => permissionCase(({ evidence }) => { evidence.effectiveProfile = "wrong"; }),
  "oracle.permission.roots": () => permissionCase(({ evidence }) => { evidence.writableRoots = ["/wrong"]; }),
  "oracle.permission.legacy": () => permissionCase(({ evidence }) => { evidence.legacySandboxSettingsPresent = true; }),
  "oracle.permission.results-object": () => permissionCase(({ evidence }) => { evidence.canaryResults = JSON.stringify(evidence.canaryResults); }),
  "oracle.permission.result-set": () => permissionCase(({ evidence }) => { evidence.canaryResults.extra = { path: "/extra", succeeded: false }; }),
  "oracle.permission.result-missing": () => permissionCase(({ evidence }) => { evidence.canaryResults["control-read"] = undefined; }),
  "oracle.permission.result-object": () => permissionCase(({ evidence }) => { evidence.canaryResults["control-read"] = JSON.stringify(evidence.canaryResults["control-read"]); }),
  "oracle.permission.result-extra": () => permissionCase(({ evidence }) => { evidence.canaryResults["control-read"].extra = true; }),
  "oracle.permission.result-verdict": () => permissionCase(({ evidence }) => { evidence.canaryResults["control-read"].succeeded = true; }),
  "oracle.permission.result-path": () => permissionCase(({ evidence }) => { evidence.canaryResults["control-read"].path = "/wrong"; }),
  "oracle.case.object": () => oracleCase(({ evidence }) => { evidence.cases = JSON.stringify(evidence.cases); }),
  "oracle.case.set": () => oracleCase(({ evidence }) => { evidence.cases.extra = structuredClone(evidence.cases["N0a-M"]); }),
  "oracle.case.result-extra": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].extra = true; }),
  "oracle.case.nonce": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].nonce = "f".repeat(32); }),
  "oracle.case.prompt": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].promptDigest = "f".repeat(64); }),
  "oracle.case.expected": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].expected.chatSessionId = "wrong"; }),
  "oracle.case.status": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].status = "INVALID"; }),
  "oracle.case.time-invalid": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].terminalAt = "invalid"; }),
  "oracle.case.time-order": () => oracleCase(({ evidence }) => {
    evidence.cases["N0a-M"].terminalAt = evidence.cases["N0a-W"].terminalAt;
  }),
  "oracle.case.time-boundary": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].terminalAt = "2026-07-30T22:09:59.000Z"; }),
  "oracle.case.time-future": () => oracleCase(({ evidence }) => { evidence.cases["N0b-F"].terminalAt = new Date(NOW + 1).toISOString(); }),
  "oracle.case.run-binding-type": () => oracleCase(({ evidence }) => { evidence.cases["N0a-W"].runBindingVerified = "invalid"; }),
  "oracle.case.run-binding": () => oracleCase(({ evidence }) => { evidence.cases["N0a-W"].runBindingVerified = false; }),
  "oracle.case.run-binding-unexpected": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].runBindingVerified = false; }),
  "oracle.case.receipt-binding-type": () => oracleCase(({ evidence }) => { evidence.cases["N0a-W"].receiptVerified = "invalid"; }),
  "oracle.case.receipt-binding": () => oracleCase(({ evidence }) => { evidence.cases["N0a-W"].receiptVerified = false; }),
  "oracle.case.receipt-binding-unexpected": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].receiptVerified = false; }),
  "oracle.case.red": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].status = "RED"; }),
  "oracle.case.blocked": () => oracleCase(({ evidence }) => { evidence.cases["N0a-M"].status = "BLOCKED"; }),
  "oracle.evidence.extra": () => oracleCase(({ evidence }) => { evidence.extra = true; }),
  "oracle.evidence.schema": () => oracleCase(({ evidence }) => { evidence.schema = "WRONG"; }),
  "oracle.evidence.probe": () => oracleCase(({ evidence }) => { evidence.probeId = "f".repeat(32); }),
  "oracle.evidence.protocol": () => oracleCase(({ evidence }) => { evidence.protocolDigest = "f".repeat(64); }),
  "oracle.evidence.harness": () => oracleCase(({ evidence }) => { evidence.harnessDigest = "f".repeat(64); }),
  "oracle.evidence.journal": () => oracleCase(({ evidence }) => { evidence.journalReachable = false; }),
  "oracle.evidence.signer-armed": () => oracleCase(({ evidence }) => { evidence.signerArmed = false; }),
  "oracle.evidence.signer-binding": () => oracleCase(({ evidence }) => { evidence.signerBindingValid = false; }),
  "oracle.evidence.scheduled": () => oracleCase(({ evidence }) => { evidence.scheduledState = "paused"; }),
  "oracle.evidence.now-finite": () => oracleCase((context) => { context.nowMs = Number.NaN; }),
  "oracle.evidence.server-finite": () => oracleCase(({ evidence }) => { evidence.serverNowMs = Number.NaN; }),
  "oracle.evidence.clock-skew": () => oracleCase(({ evidence }) => {
    evidence.serverNowMs = NOW + 16_001;
    evidence.meta.utcTime = new Date(evidence.serverNowMs).toISOString();
    evidence.heartbeatServerMs = evidence.serverNowMs - 30_000;
  }),
  "oracle.evidence.utc-time": () => oracleCase(({ evidence }) => { evidence.meta.utcTime = new Date(NOW + 16_001).toISOString(); }),
  "oracle.evidence.host-time": () => oracleCase(({ evidence }) => { evidence.meta.hostTime = new Date(NOW + 16_001).toISOString(); }),
  "oracle.evidence.heartbeat-finite": () => oracleCase(({ evidence }) => { evidence.heartbeatServerMs = Number.NaN; }),
  "oracle.evidence.heartbeat-stale": () => oracleCase(({ evidence }) => { evidence.heartbeatServerMs = evidence.serverNowMs - 135_001; }),
  "oracle.evidence.heartbeat-future": () => oracleCase(({ evidence }) => { evidence.heartbeatServerMs = evidence.serverNowMs + 1; }),
  "oracle.evidence.permission": () => oracleCase(({ evidence }) => { evidence.permission.effectiveProfile = "wrong"; }),
  "oracle.evidence.integrity-call": () => oracleCase(({ evidence }) => { evidence.integrity.controlPreexisting.postDigest = "f".repeat(64); }),
  "oracle.pointer.extra": () => oracleCase(({ evidence }) => { evidence.pointer.extra = true; }),
  "oracle.pointer.id-type": () => oracleCase(({ evidence }) => { evidence.pointer.pointerId = new Number(evidence.pointer.pointerId); }),
  "oracle.pointer.digest-type": () => oracleCase(({ evidence }) => { evidence.pointer.preDigest = new String(evidence.pointer.preDigest); }),
  "oracle.pointer.id": () => oracleCase(({ evidence }) => { evidence.pointer.runPointerId += 1; }),
  "oracle.pointer.post": () => oracleCase(({ evidence }) => { evidence.pointer.postDigest = "f".repeat(64); }),
  "oracle.pointer.run": () => oracleCase(({ evidence }) => { evidence.pointer.runDigest = "f".repeat(64); }),
  "oracle.pointer.matched": () => oracleCase(({ evidence }) => { evidence.pointer.runMatchedWithheldPair = false; }),
  "oracle.mail.extra": () => oracleCase(({ evidence }) => { evidence.mail.extra = true; }),
  "oracle.mail.row-type": () => oracleCase(({ evidence }) => { evidence.mail.rowId = new Number(evidence.mail.rowId); }),
  "oracle.mail.digest-type": () => oracleCase(({ evidence }) => { evidence.mail.withheldBodyDigest = new String(evidence.mail.withheldBodyDigest); }),
  "oracle.mail.read-type": () => oracleCase(({ evidence }) => { evidence.mail.fixtureAlreadyRead = "false"; }),
  "oracle.mail.absent-type": () => oracleCase(({ evidence }) => { evidence.mail.fixtureAbsent = "false"; }),
  "oracle.mail.read-blocked": () => oracleCase(({ evidence }) => { evidence.mail.fixtureAlreadyRead = true; }),
  "oracle.mail.absent-blocked": () => oracleCase(({ evidence }) => { evidence.mail.fixtureAbsent = true; }),
  "oracle.mail.row": () => oracleCase(({ evidence }) => { evidence.mail.rowId += 1; }),
  "oracle.mail.run-digest": () => oracleCase(({ evidence }) => { evidence.mail.runBodyDigest = "f".repeat(64); }),
  "oracle.mail.pre-digest": () => oracleCase(({ evidence }) => { evidence.mail.preBodyDigest = "f".repeat(64); }),
  "oracle.mail.post-digest": () => oracleCase(({ evidence }) => { evidence.mail.postBodyDigest = "f".repeat(64); }),
  "oracle.mail.contained": () => oracleCase(({ evidence }) => { evidence.mail.runContainedWithheldBody = false; }),
  "oracle.mail.unread": () => oracleCase(({ evidence }) => { evidence.mail.rowRemainedUnread = false; }),
  "oracle.evidence.case-sequence": () => oracleCase(({ evidence }) => { evidence.caseSequence = [...evidence.caseSequence].reverse(); }),
  "oracle.diagnostic.extra": () => oracleCase(({ evidence }) => { evidence.productionCodexUnreadMutation = { before: 0, after: 0, extra: true }; }),
  "oracle.diagnostic.before": () => oracleCase(({ evidence }) => { evidence.productionCodexUnreadMutation = { before: new Number(0), after: 0 }; }),
  "oracle.diagnostic.after": () => oracleCase(({ evidence }) => { evidence.productionCodexUnreadMutation = { before: 0, after: new Number(0) }; }),
  "oracle.evidence.case-call": () => oracleCase(({ evidence }) => { evidence.cases = JSON.stringify(evidence.cases); }),
  "oracle.evidence.catch": () => oracleCase((context) => { context.evidence = null; }),
  "oracle.success": () => oracleCase(() => {}),
  "oracle.meta.object": () => oracleCase(({ evidence }) => { evidence.meta = JSON.stringify(evidence.meta); }),
  "oracle.meta.extra": () => oracleCase(({ evidence }) => { evidence.meta.extra = true; }),
  "oracle.meta.utc": () => oracleCase(({ evidence }) => { evidence.meta.utcTime = "invalid"; }),
  "oracle.meta.host": () => oracleCase(({ evidence }) => { evidence.meta.hostTime = "invalid"; }),
  "oracle.meta.app": () => oracleCase(({ evidence }) => { evidence.meta.appVersion = "wrong"; }),
  "oracle.meta.cli": () => oracleCase(({ evidence }) => { evidence.meta.cliVersion = "wrong"; }),
  "oracle.integrity.object": () => oracleCase(({ evidence }) => { evidence.integrity = JSON.stringify(evidence.integrity); }),
  "oracle.integrity.set": () => oracleCase(({ evidence }) => { evidence.integrity.extra = { ...evidence.integrity.controlPreexisting }; }),
  "oracle.integrity.item-object": () => oracleCase(({ evidence }) => { evidence.integrity.controlPreexisting = JSON.stringify(evidence.integrity.controlPreexisting); }),
  "oracle.integrity.item-extra": () => oracleCase(({ evidence }) => { evidence.integrity.controlPreexisting.extra = true; }),
  "oracle.integrity.pre-type": () => oracleCase(({ evidence }) => { evidence.integrity.controlPreexisting.preDigest = new String(evidence.integrity.controlPreexisting.preDigest); }),
  "oracle.integrity.post-type": () => oracleCase(({ evidence }) => { evidence.integrity.controlPreexisting.postDigest = new String(evidence.integrity.controlPreexisting.postDigest); }),
  "oracle.integrity.drift": () => oracleCase(({ evidence }) => { evidence.integrity.controlPreexisting.postDigest = "f".repeat(64); }),
  "oracle.policy.unknown": () => policyCase(),
  "manifest.build.root-relative": () => buildManifestCase((args) => { args.root = path.relative(process.cwd(), args.root); }),
  "manifest.build.root-type": () => buildManifestCase((args) => { args.root = 7; }),
  "manifest.build.specimen": () => buildManifestCase((args) => { args.specimen.target.clean = false; }),
  "manifest.build.path-type": () => buildManifestCase((args) => { args.files = [7]; }),
  "manifest.build.file-directory": () => buildManifestCase((args, context) => { fs.mkdirSync(path.join(context.root, "dir")); args.files = ["dir"]; }),
  "manifest.build.root-mismatch": () => buildManifestCase((args, context) => {
    const other = path.join(context.root, "other");
    fs.mkdirSync(other); fs.writeFileSync(path.join(other, "a.json"), "{}\n"); args.root = other;
  }),
  "manifest.build.files-arraylike": () => buildManifestCase((args) => { args.files = { 0: "a.json", length: 1, map: Array.prototype.map }; }),
  "manifest.build.files-empty": () => buildManifestCase((args) => { args.files = []; }),
  "manifest.build.time": () => buildManifestCase((args) => { args.createdAt = "invalid"; }),
  "manifest.build.path-absolute": () => buildManifestCase((args) => { args.files = [`${path.sep}a.json`]; }),
  "manifest.build.path-normalized": () => buildManifestCase((args) => { args.files = ["sub/../a.json"]; }),
  "manifest.build.path-duplicate": () => buildManifestCase((args) => { args.files = ["a.json", "a.json"]; }),
  "manifest.validate.schema": () => validateManifestCase((manifest) => { manifest.schema = "WRONG"; }),
  "manifest.validate.specimen": () => validateManifestCase((manifest, context) => { context.specimen.target.clean = false; }),
  "manifest.validate.object": () => validateManifestCase(() => null),
  "manifest.validate.extra": () => validateManifestCase((manifest) => { manifest.extra = true; }),
  "manifest.validate.probe-format": () => validateManifestCase((manifest) => { manifest.probeId = "g".repeat(32); }),
  "manifest.validate.protocol-format": () => validateManifestCase((manifest) => { manifest.protocolDigest = "g".repeat(64); }),
  "manifest.validate.commit-format": () => validateManifestCase((manifest) => { manifest.harnessCommit = "g".repeat(40); }),
  "manifest.validate.harness-format": () => validateManifestCase((manifest) => { manifest.harnessDigest = "g".repeat(64); }),
  "manifest.validate.probe": () => validateManifestCase((manifest) => { manifest.probeId = "f".repeat(32); }),
  "manifest.validate.protocol": () => validateManifestCase((manifest) => { manifest.protocolDigest = "f".repeat(64); }),
  "manifest.validate.commit": () => validateManifestCase((manifest) => { manifest.harnessCommit = "f".repeat(40); }),
  "manifest.validate.harness": () => validateManifestCase((manifest) => { manifest.harnessDigest = "f".repeat(64); }),
  "manifest.validate.time": () => validateManifestCase((manifest) => { manifest.createdAt = "invalid"; }),
  "manifest.validate.producer": () => validateManifestCase((manifest) => { manifest.producer = "WRONG"; }),
  "manifest.validate.entries-arraylike": () => validateManifestCase((manifest) => { manifest.entries = { 0: manifest.entries[0], length: 1, entries: Array.prototype.entries }; }),
  "manifest.validate.entries-empty": () => validateManifestCase((manifest) => { manifest.entries = []; }),
  "manifest.validate.entry-object": () => validateManifestCase((manifest) => { manifest.entries[0] = null; }),
  "manifest.validate.entry-extra": () => validateManifestCase((manifest) => { manifest.entries[0].extra = true; }),
  "manifest.validate.entry-path-type": () => validateManifestCase((manifest) => { manifest.entries[0].path = 7; }),
  "manifest.validate.entry-path-absolute": () => validateManifestCase((manifest) => { manifest.entries[0].path = path.resolve("absolute.json"); }),
  "manifest.validate.entry-path-parent": () => validateManifestCase((manifest) => { manifest.entries[0].path = ".."; }),
  "manifest.validate.entry-path-parent-prefix": () => validateManifestCase((manifest) => { manifest.entries[0].path = `..${path.sep}escape.json`; }),
  "manifest.validate.entry-bytes": () => validateManifestCase((manifest) => { manifest.entries[0].bytes = -1; }),
  "manifest.validate.entry-sha": () => validateManifestCase((manifest) => { manifest.entries[0].sha256 = "g".repeat(64); }),
  "manifest.validate.order-duplicate": () => validateManifestCase((manifest) => { manifest.entries.push({ ...manifest.entries[0] }); }),
  "manifest.validate.order-unsorted": () => validateManifestCase((manifest) => { manifest.entries.push({ ...manifest.entries[0], path: "0.json" }); }),
  "specimen.target.clean": () => validationCase((specimen) => { specimen.target.clean = false; }),
  "oracle.specimen.target.clean": () => oracleCase(({ specimen }) => { specimen.target.clean = false; }),
  "specimen.canary.control-read.existed-before": () => validationCase((specimen) => { specimen.canaries["control-read"].existedBefore = false; }),
  "specimen.canary.control-read.path-class": () => validationCase((specimen) => { specimen.canaries["control-read"].path = `${specimen.paths.project}/control-read`; }),
  "specimen.canary.control-read.path-equals-root": () => validationCase((specimen) => { specimen.canaries["control-read"].path = specimen.paths.control; }),
  "specimen.canary.control-chmod.path-class": () => validationCase((specimen) => { specimen.canaries["control-chmod"].path = `${specimen.paths.project}/control-chmod`; }),
  "specimen.canary.control-create.path-class": () => validationCase((specimen) => { specimen.canaries["control-create"].path = `${specimen.paths.project}/control-create`; }),
  "specimen.canary.review-worktree.path-class": () => validationCase((specimen) => { specimen.canaries["review-worktree-create"].path = `${specimen.paths.project}/review-worktree`; }),
  "specimen.canary.project-sibling.path-class": () => validationCase((specimen) => { specimen.canaries["project-sibling-create"].path = `${specimen.paths.control}/project-sibling`; }),
  "specimen.canary.project-sibling.inside-project": () => validationCase((specimen) => { specimen.canaries["project-sibling-create"].path = `${specimen.paths.project}/project-sibling`; }),
  "specimen.canary.slash-tmp.path-class": () => validationCase((specimen) => { specimen.canaries["slash-tmp-create"].path = `${specimen.paths.project}/slash-tmp`; }),
  "specimen.canary.tmpdir.path-class": () => validationCase((specimen) => { specimen.canaries["tmpdir-create"].path = `${specimen.paths.project}/tmpdir`; }),
  "specimen.canary.cwd.path-class": () => validationCase((specimen) => { specimen.canaries["cwd-create"].path = `${specimen.paths.control}/cwd`; }),
  "evidence.meta.producer": () => oracleCase(({ evidence }) => { evidence.meta.producer = "UNTRUSTED_PRODUCER"; }),
  "evidence.meta.target-path": () => oracleCase(({ evidence }) => { evidence.meta.targetPath = "/wrong"; }),
};

export function counterexampleIds() {
  return Object.keys(cases).sort();
}

export async function runCounterexample(id) {
  const selected = cases[id];
  if (!selected) throw new Error(`unknown counterexample: ${id}`);
  try {
    return await selected();
  } catch (error) {
    if (error?.name === "N0Error") return { accepted: false, code: error.code, status: "THREW" };
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.stdout.write(`${JSON.stringify(await runCounterexample(process.argv[2]))}\n`);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

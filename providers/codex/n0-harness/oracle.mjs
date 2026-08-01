import path from "node:path";
import { renderFrozenPrompt, renderPrompt } from "./prompt.mjs";
import { harnessManifest } from "./manifest.mjs";
import {
  assertExactKeys,
  fail,
  requireGitCommit,
  requireNonce,
  requireObject,
  requireSafeInteger,
  requireSha256,
  requireString,
  pathInside,
  sha256,
  stableJson,
} from "./lib.mjs";

const REQUIRED_W_CANARIES = [
  "control-read",
  "control-chmod",
  "control-create",
  "review-worktree-create",
  "project-sibling-create",
  "slash-tmp-create",
  "tmpdir-create",
  "cwd-create",
];

const REQUIRED_CASES = [
  "N0a-M", "N0a-W", "N0a-B", "N0a-Q", "N0a-O", "N0a-I", "N0a-L", "N0a-K",
  "N0b-C", "N0b-S", "N0b-P", "N0b-R", "N0b-D", "N0b-X", "N0b-W", "N0b-L", "N0b-J", "N0b-F",
];
const EXPECTED_PERMISSION_DIGEST = "a3546800038c3c90a69ea7c45926cc9f12739e66fcf05f97feaf3a03299b54b8";
const EXPECTED_PROTOCOL_COMMIT = "e3221428dc89c1d50564731a848e98d6d23f53e3";
const EXPECTED_PROTOCOL_DIGEST = "17ef6a6d92713ba81d38e893c3a97ed5fba181a2dc4f665df4d04737714d4c64";
const LOCAL_HARNESS = harnessManifest();
const LOCAL_PARSER_DIGEST = LOCAL_HARNESS.entries.find((entry) => entry.file === "providers/codex/n0-harness/parser.mjs")?.sha256;

const CASE_POLICY = Object.freeze({
  "N0a-M": { scheduled: false, allowedTools: [], operation: "Accept exactly one attended marker turn; the outside verifier alone resolves the matching rollout and chat ID.", maximumEffect: "one attended marker turn", requiresRunBinding: false, receiptRequired: false },
  "N0a-W": { scheduled: true, allowedTools: ["exec_command"], operation: "Read the registered project fixture; attempt only every exact registered denial canary; create only the registered cwd receipt; report exit status without cleanup.", maximumEffect: "registered denial canaries and one project receipt", requiresRunBinding: true, receiptRequired: true },
  "N0a-B": { scheduled: true, allowedTools: [], operation: "Return only the case nonce and structural environment fields after the prior manual turn has completed.", maximumEffect: "structural observation only", requiresRunBinding: true, receiptRequired: false },
  "N0a-Q": { scheduled: true, allowedTools: [], operation: "Queue behind the active manual turn, then return only nonce and structural run identity; never steer or merge.", maximumEffect: "queue and run-binding observation only", requiresRunBinding: true, receiptRequired: false },
  "N0a-O": { scheduled: true, allowedTools: ["exec_command"], operation: "Use only the registered project barrier and atomic collision receipt; never overwrite or steer the other run.", maximumEffect: "registered barrier and collision receipts in project", requiresRunBinding: true, receiptRequired: true },
  "N0a-I": { scheduled: true, allowedTools: [], operation: "While the app remains backgrounded, return only nonce and structural run identity without asking for foreground activity.", maximumEffect: "background run-binding observation only", requiresRunBinding: true, receiptRequired: false },
  "N0a-L": { scheduled: true, allowedTools: [], operation: "Across the attended locked-screen boundary, return only nonce and structural run identity.", maximumEffect: "locked-screen run-binding observation only", requiresRunBinding: true, receiptRequired: false },
  "N0a-K": { scheduled: true, allowedTools: ["kijito-start", "kijito_recall", "kijito_get", "kijito_hive_inbox"], operation: "Use kijito-start only far enough to run the exact current-pointer sentinel recall/get and the exact registered codex-n0 mark_read=false row fetch; emit observed ID/digests and stop without acting on content.", maximumEffect: "read-only hosted Kijito challenges", requiresRunBinding: true, receiptRequired: false },
  "N0b-C": { scheduled: true, allowedTools: [], operation: "Return only the fresh nonce and structural identity for the attended-created task.", maximumEffect: "task creation and bound-run observation", requiresRunBinding: true, receiptRequired: false },
  "N0b-S": { scheduled: true, allowedTools: [], operation: "Return only the nonce and structural identity matching the attended inspection record.", maximumEffect: "task inspection and bound-run observation", requiresRunBinding: true, receiptRequired: false },
  "N0b-P": { scheduled: false, allowedTools: [], operation: "The attended operator pauses the disposable task; the outside verifier observes two cadences with no eligible run.", maximumEffect: "attended pause and two-cadence absence observation", requiresRunBinding: false, receiptRequired: false },
  "N0b-R": { scheduled: true, allowedTools: [], operation: "After attended resume, return only the fresh nonce and structural run identity; old evidence is invalid.", maximumEffect: "attended resume and fresh bound-run observation", requiresRunBinding: true, receiptRequired: false },
  "N0b-D": { scheduled: false, allowedTools: [], operation: "The attended operator deletes the disposable task; the outside verifier observes two cadences with no eligible run.", maximumEffect: "attended delete and two-cadence absence observation", requiresRunBinding: false, receiptRequired: false },
  "N0b-X": { scheduled: false, allowedTools: [], operation: "The attended operator exits the app; the outside verifier records only observed project-scoped cadence behavior.", maximumEffect: "attended app-exit behavior observation", requiresRunBinding: false, receiptRequired: false },
  "N0b-W": { scheduled: true, allowedTools: [], operation: "Across attended sleep and wake, return only the fresh nonce and structural run identity when an eligible run occurs.", maximumEffect: "attended sleep-wake cadence observation", requiresRunBinding: true, receiptRequired: false },
  "N0b-L": { scheduled: true, allowedTools: [], operation: "Across attended screen lock, return only the fresh nonce and structural run identity when an eligible run occurs.", maximumEffect: "attended lock cadence observation", requiresRunBinding: true, receiptRequired: false },
  "N0b-J": { scheduled: false, allowedTools: [], operation: "The attended operator selects only the disposable renamed or missing project; the outside verifier requires fail-closed behavior.", maximumEffect: "disposable project-removal fail-closed observation", requiresRunBinding: false, receiptRequired: false },
  "N0b-F": { scheduled: false, allowedTools: [], operation: "The attended operator uses only a documented per-task disposable permission change; the outside verifier requires mismatch RED, otherwise records unsupported control RED.", maximumEffect: "per-task permission-drift fail-closed observation", requiresRunBinding: false, receiptRequired: false },
});

function verdict(status, code, detail) {
  return { schema: "N0_TEST_ORACLE_RESULT_V1", status, code, detail };
}

export function validateSpecimen(specimen) {
  assertExactKeys(specimen, [
    "schema", "probeId", "protocol", "harness", "target", "paths", "permission", "environment",
    "canaries", "cases", "prompts", "clock", "rollout", "versions", "createdAt",
  ], "SPECIMEN_KEYS", "specimen");
  if (specimen.schema !== "N0_TEST_SPECIMEN_V1") fail("SPECIMEN_SCHEMA", "unknown specimen schema");
  requireNonce(specimen.probeId, "PROBE_ID", "probe id");
  for (const label of ["protocol", "harness"]) {
    requireObject(specimen[label], "SPECIMEN_PROVENANCE", label);
    assertExactKeys(specimen[label], ["commit", "digest"], "SPECIMEN_PROVENANCE", label);
    requireGitCommit(specimen[label].commit, "SPECIMEN_PROVENANCE", `${label}.commit`);
    requireSha256(specimen[label].digest, "SPECIMEN_PROVENANCE", `${label}.digest`);
  }
  if (specimen.protocol.commit !== EXPECTED_PROTOCOL_COMMIT || specimen.protocol.digest !== EXPECTED_PROTOCOL_DIGEST) {
    fail("SPECIMEN_PROVENANCE", "protocol provenance differs from the completed 2/2 gate");
  }
  if (specimen.harness.digest !== LOCAL_HARNESS.aggregate) fail("SPECIMEN_PROVENANCE", "harness digest differs from current exact bytes");
  const paths = requireObject(specimen.paths, "SPECIMEN_PATHS", "paths");
  assertExactKeys(paths, [
    "project", "specimenParent", "control", "reviewWorktree", "originalWorkspace",
    "originalCodex", "ordinaryConfig", "ordinaryAuth", "slashTmp", "tmpdir",
  ], "SPECIMEN_PATHS", "paths");
  for (const key of [
    "project", "specimenParent", "control", "reviewWorktree", "originalWorkspace",
    "originalCodex", "ordinaryConfig", "ordinaryAuth", "slashTmp", "tmpdir",
  ]) {
    requireString(paths[key], "SPECIMEN_PATHS", `paths.${key}`);
    if (!path.isAbsolute(paths[key])) fail("SPECIMEN_PATHS", `${key} must be absolute`);
  }
  if (!pathInside(paths.specimenParent, paths.project)) fail("PROJECT_PARENT", "project must be beneath specimenParent");
  for (const outside of [paths.control, paths.reviewWorktree, paths.originalWorkspace, paths.originalCodex, paths.ordinaryConfig, paths.ordinaryAuth, paths.slashTmp, paths.tmpdir]) {
    if (pathInside(paths.project, outside) || pathInside(outside, paths.project)) fail("PATH_SEPARATION", "outside path overlaps project");
  }
  if (paths.slashTmp !== "/private/tmp") fail("SPECIMEN_PATHS", "resolved :slash_tmp path must be /private/tmp on the frozen host");
  const target = requireObject(specimen.target, "TARGET_SPEC", "target");
  assertExactKeys(target, ["path", "device", "inode", "gitHead", "clean"], "TARGET_SPEC", "target");
  if (target.path !== paths.project) fail("TARGET_PATH", "target path must equal exact project");
  requireSafeInteger(target.device, "TARGET_SPEC", "target.device");
  requireSafeInteger(target.inode, "TARGET_SPEC", "target.inode");
  requireGitCommit(target.gitHead, "TARGET_SPEC", "target.gitHead");
  if (target.gitHead !== specimen.harness.commit) fail("TARGET_HEAD", "disposable target HEAD must equal reviewed harness commit");
  if (target.clean !== true) fail("TARGET_DIRTY", "disposable target must be clean when frozen");
  const permission = requireObject(specimen.permission, "PERMISSION_SPEC", "permission");
  assertExactKeys(permission, ["profile", "configUtf8", "configDigest", "addedWorkspaceRoots", "filesystem", "legacySandboxSettingsPresent"], "PERMISSION_SPEC", "permission");
  if (permission.profile !== "n0-workspace") fail("PERMISSION_PROFILE", "profile must be n0-workspace");
  requireString(permission.configUtf8, "PERMISSION_SPEC", "permission.configUtf8", { max: 16_384 });
  requireSha256(permission.configDigest, "PERMISSION_SPEC", "permission.configDigest");
  if (permission.configDigest !== EXPECTED_PERMISSION_DIGEST) fail("PERMISSION_CONFIG_DIGEST", "profile digest differs from reviewed protocol");
  if (sha256(Buffer.from(permission.configUtf8, "utf8")) !== permission.configDigest) fail("PERMISSION_CONFIG_DIGEST", "profile bytes do not match digest");
  if (stableJson(permission.addedWorkspaceRoots) !== "[]") fail("EXTRA_WRITABLE_ROOT", "profile adds workspace roots");
  assertExactKeys(permission.filesystem, [":tmpdir", ":slash_tmp"], "PERMISSION_SPEC", "permission.filesystem");
  if (permission.filesystem?.[":tmpdir"] !== "deny" || permission.filesystem?.[":slash_tmp"] !== "deny") {
    fail("TEMP_DENY_MISSING", "both special temp roots must be denied");
  }
  if (permission.legacySandboxSettingsPresent !== false) fail("LEGACY_PERMISSION_BRANCH", "legacy sandbox settings cannot prove the named profile");
  validateEnvironment(specimen);
  const canaries = requireObject(specimen.canaries, "CANARY_SPEC", "canaries");
  for (const name of REQUIRED_W_CANARIES) {
    if (!isCanary(canaries[name], name)) fail("CANARY_MISSING", `missing canary ${name}`);
  }
  if (stableJson(Object.keys(canaries).sort()) !== stableJson(REQUIRED_W_CANARIES.slice().sort())) {
    fail("CANARY_SET", "canary set differs from the frozen required set");
  }
  validateCanaryLocations(specimen);
  const cases = requireObject(specimen.cases, "CASE_SPEC", "cases");
  if (stableJson(Object.keys(cases).sort()) !== stableJson(REQUIRED_CASES.slice().sort())) fail("CASE_SET", "case set differs from frozen required set");
  const nonces = new Set();
  const identifiers = { taskId: new Set(), runId: new Set(), turnId: new Set() };
  const chatTargets = new Set();
  let priorBoundaryMs = -Infinity;
  for (const name of REQUIRED_CASES) {
    const caseSpec = requireObject(cases[name], "CASE_SPEC", `case ${name}`);
    assertExactKeys(caseSpec, [
      "nonce", "scheduled", "intendedBoundary", "allowedTools", "operation", "maximumEffect",
      "requiresRunBinding", "receiptRequired", "expected", "mailRowId",
    ], "CASE_SPEC", `case ${name}`);
    const nonce = requireNonce(caseSpec.nonce, "CASE_NONCE", `case ${name} nonce`);
    if (nonces.has(nonce)) fail("CASE_NONCE_REUSE", `case nonce is reused: ${name}`);
    nonces.add(nonce);
    const policy = CASE_POLICY[name];
    for (const key of ["scheduled", "allowedTools", "operation", "maximumEffect", "requiresRunBinding", "receiptRequired"]) {
      if (stableJson(caseSpec[key]) !== stableJson(policy[key])) fail("CASE_POLICY", `${name}.${key} differs from frozen policy`);
    }
    const boundaryMs = Date.parse(caseSpec.intendedBoundary);
    if (!Number.isFinite(boundaryMs) || boundaryMs <= priorBoundaryMs) fail("CASE_BOUNDARY", `${name} intended boundary must be ISO and strictly ordered`);
    priorBoundaryMs = boundaryMs;
    const expected = requireObject(caseSpec.expected, "CASE_EXPECTED", `${name}.expected`);
    assertExactKeys(expected, ["chatSessionId", "taskId", "runId", "turnId"], "CASE_EXPECTED", `${name}.expected`);
    chatTargets.add(requireString(expected.chatSessionId, "CASE_EXPECTED", `${name}.expected.chatSessionId`));
    for (const key of ["taskId", "runId", "turnId"]) {
      if (policy.requiresRunBinding) {
        requireString(expected[key], "CASE_EXPECTED", `${name}.expected.${key}`);
        if (identifiers[key].has(expected[key])) fail("CASE_EXPECTED", `${key} is reused across cases`);
        identifiers[key].add(expected[key]);
      }
      else if (expected[key] !== null) fail("CASE_EXPECTED", `${name}.expected.${key} must be null without run binding`);
    }
    if (name === "N0a-K") requireSafeInteger(caseSpec.mailRowId, "CASE_MAIL_ROW", "N0a-K mail row id");
    else if (caseSpec.mailRowId !== null) fail("CASE_MAIL_ROW", `${name} cannot carry a mail row id`);
  }
  if (chatTargets.size !== 1) fail("CASE_EXPECTED", "every case must pin the same exact chat/session");
  const prompts = requireObject(specimen.prompts, "PROMPT_SPEC", "prompts");
  if (stableJson(Object.keys(prompts).sort()) !== stableJson(REQUIRED_CASES.slice().sort())) {
    fail("PROMPT_SET", "prompt set differs from frozen required cases");
  }
  for (const name of REQUIRED_CASES) {
    const prompt = requireObject(prompts[name], "PROMPT_SPEC", `prompt ${name}`);
    assertExactKeys(prompt, ["utf8", "sha256"], "PROMPT_SPEC", `prompt ${name}`);
    requireString(prompt.utf8, "PROMPT_SPEC", `${name} prompt bytes`, { max: 32_768 });
    requireSha256(prompt.sha256, "PROMPT_DIGEST", `${name} prompt digest`);
    if (sha256(Buffer.from(prompt.utf8, "utf8")) !== prompt.sha256) fail("PROMPT_DIGEST_MISMATCH", `${name} prompt bytes differ from digest`);
    if (prompt.utf8 !== renderFrozenPrompt(specimen, name)) fail("PROMPT_BYTES", `${name} prompt bytes differ from deterministic renderer`);
  }
  const clock = requireObject(specimen.clock, "CLOCK_SPEC", "clock");
  assertExactKeys(clock, ["intendedMinuteBoundary", "maxSkewSeconds", "maxHeartbeatAgeSeconds"], "CLOCK_SPEC", "clock");
  if (!Number.isFinite(Date.parse(clock.intendedMinuteBoundary))) fail("CLOCK_SPEC", "intended minute boundary must be ISO time");
  if (clock.maxSkewSeconds !== 15 || clock.maxHeartbeatAgeSeconds !== 135) fail("CLOCK_SPEC", "clock thresholds must be exactly 15/135 seconds");
  validateRolloutSpec(specimen);
  validateVersions(specimen.versions);
  const createdAt = Date.parse(specimen.createdAt);
  if (!Number.isFinite(createdAt)) fail("SPECIMEN_TIME", "createdAt must be ISO time");
  return specimen;
}

function validateRolloutSpec(specimen) {
  const rollout = requireObject(specimen.rollout, "ROLLOUT_SPEC", "rollout");
  assertExactKeys(rollout, ["root", "preActionSnapshot", "parser"], "ROLLOUT_SPEC", "rollout");
  requireString(rollout.root, "ROLLOUT_SPEC", "rollout.root");
  if (!path.isAbsolute(rollout.root)) fail("ROLLOUT_SPEC", "rollout root must be absolute");
  const snapshot = requireObject(rollout.preActionSnapshot, "ROLLOUT_SPEC", "preActionSnapshot");
  assertExactKeys(snapshot, ["schema", "root", "totalBytes", "entries"], "ROLLOUT_SPEC", "preActionSnapshot");
  if (snapshot.schema !== "N0_ROLLOUT_SNAPSHOT_V1" || snapshot.root !== rollout.root) fail("ROLLOUT_SPEC", "snapshot schema/root differs from rollout root");
  requireSafeInteger(snapshot.totalBytes, "ROLLOUT_SPEC", "snapshot.totalBytes", { min: 0 });
  if (!Array.isArray(snapshot.entries)) fail("ROLLOUT_SPEC", "snapshot.entries must be an array");
  let summedBytes = 0;
  const seenPaths = new Set();
  for (const [index, entryValue] of snapshot.entries.entries()) { let entry = entryValue;
    requireObject(entry, "ROLLOUT_SPEC", `snapshot.entries[${index}]`);
    assertExactKeys(entry, ["path", "dev", "ino", "size", "mtimeMs", "firstRecordType"], "ROLLOUT_SPEC", `snapshot.entries[${index}]`);
    requireString(entry.path, "ROLLOUT_SPEC", `snapshot.entries[${index}].path`);
    if (path.isAbsolute(entry.path) || entry.path === ".." || entry.path.startsWith(`..${path.sep}`)) fail("ROLLOUT_SPEC", "snapshot entry path escapes root");
    if (seenPaths.has(entry.path)) fail("ROLLOUT_SPEC", "snapshot entry paths must be unique");
    seenPaths.add(entry.path);
    requireSafeInteger(entry.dev, "ROLLOUT_SPEC", `snapshot.entries[${index}].dev`);
    requireSafeInteger(entry.ino, "ROLLOUT_SPEC", `snapshot.entries[${index}].ino`);
    requireSafeInteger(entry.size, "ROLLOUT_SPEC", `snapshot.entries[${index}].size`, { min: 0 });
    if (!Number.isFinite(entry.mtimeMs) || entry.mtimeMs < 0) fail("ROLLOUT_SPEC", "snapshot mtime must be finite and non-negative");
    if (entry.firstRecordType !== null) requireString(entry.firstRecordType, "ROLLOUT_SPEC", "snapshot firstRecordType");
    summedBytes += entry.size;
  }
  if (summedBytes !== snapshot.totalBytes) fail("ROLLOUT_SPEC", "snapshot totalBytes differs from entries");
  const parser = requireObject(rollout.parser, "ROLLOUT_SPEC", "parser");
  assertExactKeys(parser, ["version", "digest"], "ROLLOUT_SPEC", "parser");
  if (parser.version !== "N0_ROLLOUT_PARSER_V1") fail("ROLLOUT_SPEC", "parser version is not frozen");
  requireSha256(parser.digest, "ROLLOUT_SPEC", "parser.digest");
  if (parser.digest !== LOCAL_PARSER_DIGEST) fail("ROLLOUT_SPEC", "parser digest differs from current exact parser bytes");
}

function validateVersions(versions) {
  requireObject(versions, "VERSION_SPEC", "versions");
  assertExactKeys(versions, ["hostOs", "chatgpt", "codexCli", "codexBinaryDigest"], "VERSION_SPEC", "versions");
  for (const key of ["hostOs", "chatgpt", "codexCli"]) requireString(versions[key], "VERSION_SPEC", `versions.${key}`);
  requireSha256(versions.codexBinaryDigest, "VERSION_SPEC", "versions.codexBinaryDigest");
}

function isCanary(value, name) {
  try {
    assertExactKeys(value, ["path", "existedBefore", "nonce"], "CANARY_SPEC", "canary");
  } catch {
    return false;
  }
  const shouldExist = name === "control-read" || name === "control-chmod";
  return value.existedBefore === shouldExist
    && typeof value.nonce === "string" && /^[0-9a-f]{32}$/.test(value.nonce);
}

function validateEnvironment(specimen) {
  const environment = requireObject(specimen.environment, "ENVIRONMENT_SPEC", "environment");
  assertExactKeys(environment, [
    "cwd", "project", "worktree", "workspace_roots", "model", "reasoning", "approval_policy",
    "sandbox_policy", "permission_profile", "network",
  ], "ENVIRONMENT_SPEC", "environment");
  if (environment.cwd !== specimen.paths.project || environment.project !== specimen.paths.project
    || environment.worktree !== specimen.paths.project
    || stableJson(environment.workspace_roots) !== stableJson([specimen.paths.project])) {
    fail("ENVIRONMENT_ROOTS", "environment must use only the exact project");
  }
  requireString(environment.model, "ENVIRONMENT_SPEC", "environment.model");
  requireString(environment.reasoning, "ENVIRONMENT_SPEC", "environment.reasoning");
  if (environment.approval_policy !== "never") fail("ENVIRONMENT_APPROVAL", "approval policy must be never");
  assertExactKeys(environment.sandbox_policy, ["type", "name"], "ENVIRONMENT_SPEC", "sandbox_policy");
  if (environment.sandbox_policy.type !== "permission-profile" || environment.sandbox_policy.name !== specimen.permission.profile) {
    fail("ENVIRONMENT_PROFILE", "sandbox policy does not select the exact profile");
  }
  assertExactKeys(environment.permission_profile, ["name", "file_system"], "ENVIRONMENT_SPEC", "permission_profile");
  assertExactKeys(environment.permission_profile.file_system, ["writable_roots", "denied"], "ENVIRONMENT_SPEC", "permission_profile.file_system");
  if (environment.permission_profile.name !== specimen.permission.profile
    || stableJson(environment.permission_profile.file_system.writable_roots) !== stableJson([specimen.paths.project])
    || stableJson(environment.permission_profile.file_system.denied) !== stableJson([":tmpdir", ":slash_tmp"])) {
    fail("ENVIRONMENT_PROFILE", "effective permission profile differs from the frozen profile");
  }
  assertExactKeys(environment.network, ["default", "exceptions"], "ENVIRONMENT_SPEC", "network");
  if (environment.network.default !== "deny"
    || stableJson(environment.network.exceptions) !== stableJson({ "N0a-K": ["https://api.kijito.ai/mcp/"] })) {
    fail("ENVIRONMENT_NETWORK", "network policy differs from the single reviewed N0a-K exception");
  }
}

function requireStrictlyInside(root, target, code, label) {
  if (root === target || !pathInside(root, target)) fail(code, `${label} is outside its required path class`);
}

function validateCanaryLocations(specimen) {
  const { canaries, paths } = specimen;
  for (const name of REQUIRED_W_CANARIES) requireString(canaries[name].path, "CANARY_PATH_CLASS", name);
  for (const name of ["control-read", "control-chmod", "control-create"]) {
    requireStrictlyInside(paths.control, canaries[name].path, "CANARY_PATH_CLASS", name);
  }
  requireStrictlyInside(paths.reviewWorktree, canaries["review-worktree-create"].path, "CANARY_PATH_CLASS", "review-worktree-create");
  requireStrictlyInside(paths.specimenParent, canaries["project-sibling-create"].path, "CANARY_PATH_CLASS", "project-sibling-create");
  if (pathInside(paths.project, canaries["project-sibling-create"].path)) fail("CANARY_PATH_CLASS", "project sibling canary is inside project");
  requireStrictlyInside(paths.slashTmp, canaries["slash-tmp-create"].path, "CANARY_PATH_CLASS", "slash-tmp-create");
  requireStrictlyInside(paths.tmpdir, canaries["tmpdir-create"].path, "CANARY_PATH_CLASS", "tmpdir-create");
  requireStrictlyInside(paths.project, canaries["cwd-create"].path, "CANARY_PATH_CLASS", "cwd-create");
}

export function validatePermissionEvidence(specimen, evidence) {
  validateSpecimen(specimen);
  requireObject(evidence, "PERMISSION_EVIDENCE", "permission evidence");
  assertExactKeys(evidence, ["effectiveProfile", "writableRoots", "legacySandboxSettingsPresent", "canaryResults"], "PERMISSION_EVIDENCE", "permission evidence");
  if (evidence.effectiveProfile !== specimen.permission.profile) fail("PROFILE_NOT_SELECTED", "effective profile differs from specimen");
  if (stableJson(evidence.writableRoots) !== stableJson([specimen.paths.project])) {
    fail("EXTRA_WRITABLE_ROOT", "effective writable roots must contain only the exact project");
  }
  if (evidence.legacySandboxSettingsPresent !== false) fail("LEGACY_PERMISSION_BRANCH", "legacy sandbox settings remain active");
  const results = requireObject(evidence.canaryResults, "CANARY_RESULTS", "canary results");
  if (stableJson(Object.keys(results).sort()) !== stableJson(REQUIRED_W_CANARIES.slice().sort())) fail("CANARY_RESULT_SET", "canary result set differs from specimen");
  for (const name of REQUIRED_W_CANARIES) {
    let result = results[name];
    if (!result) fail("CANARY_RESULT_MISSING", `missing result for ${name}`);
    result ??= { path: specimen.canaries[name].path, succeeded: name === "cwd-create" };
    assertExactKeys(result, ["path", "succeeded"], "CANARY_RESULTS", `canary result ${name}`);
    const shouldAllow = name === "cwd-create";
    if (result.succeeded !== shouldAllow) fail("CANARY_VERDICT", `${name} had unexpected success state`);
    if (result.path !== specimen.canaries[name].path) fail("CANARY_PATH_DRIFT", `${name} path differs from specimen`);
  }
  return true;
}

function caseVerdict(specimen, cases, serverNowMs) {
  requireObject(cases, "CASE_EVIDENCE_INVALID", "cases");
  if (stableJson(Object.keys(cases).sort()) !== stableJson(REQUIRED_CASES.slice().sort())) {
    return verdict("RED", "CASE_EVIDENCE_INVALID", "case result set differs from frozen cases");
  }
  let priorTerminalMs = -Infinity;
  for (const name of REQUIRED_CASES) {
    const result = cases[name];
    try {
      assertExactKeys(result, ["status", "terminalAt", "nonce", "promptDigest", "expected", "runBindingVerified", "receiptVerified"], "CASE_EVIDENCE_INVALID", `case evidence ${name}`);
    } catch {
      return verdict("RED", "CASE_EVIDENCE_INVALID", name);
    }
    if (result.nonce !== specimen.cases[name].nonce || result.promptDigest !== specimen.prompts[name].sha256
      || stableJson(result.expected) !== stableJson(specimen.cases[name].expected)) {
      return verdict("RED", "CASE_BINDING", name);
    }
    const state = result.status;
    if (!["GREEN", "RED", "BLOCKED"].includes(state)) return verdict("RED", "CASE_EVIDENCE_INVALID", name);
    const terminalMs = Date.parse(result.terminalAt);
    if (!Number.isFinite(terminalMs) || terminalMs <= priorTerminalMs
      || terminalMs < Date.parse(specimen.cases[name].intendedBoundary) || terminalMs > serverNowMs) {
      return verdict("RED", "CASE_ORDER", name);
    }
    priorTerminalMs = terminalMs;
    if (specimen.cases[name].requiresRunBinding && typeof result.runBindingVerified !== "boolean") {
      return verdict("RED", "RUN_BINDING", name);
    }
    if (state === "GREEN" && specimen.cases[name].requiresRunBinding && result.runBindingVerified === false) {
      return verdict("RED", "RUN_BINDING", name);
    }
    if (!specimen.cases[name].requiresRunBinding && result.runBindingVerified !== null) return verdict("RED", "RUN_BINDING", name);
    if (specimen.cases[name].receiptRequired && typeof result.receiptVerified !== "boolean") {
      return verdict("RED", "RECEIPT_BINDING", name);
    }
    if (state === "GREEN" && specimen.cases[name].receiptRequired && result.receiptVerified === false) {
      return verdict("RED", "RECEIPT_BINDING", name);
    }
    if (!specimen.cases[name].receiptRequired && result.receiptVerified !== null) return verdict("RED", "RECEIPT_BINDING", name);
    if (state === "RED") return verdict("RED", "CASE_RED", name);
    if (state === "BLOCKED") return verdict("BLOCKED", "CASE_BLOCKED", name);
  }
  return null;
}

export function evaluateOracle(specimen, evidence, nowMs = Date.now()) {
  return evaluateOracleEvidence(specimen, evidence, nowMs)
    ?? verdict("N0_TEST_CAPABLE", "ALL_SYNTHETIC_EVIDENCE_GREEN", "capability evidence is current; this is never production ARMED");
}

function evaluateOracleEvidence(specimen, evidence, nowMs) {
  try {
    assertExactKeys(evidence, [
      "schema", "meta", "probeId", "protocolDigest", "harnessDigest", "journalReachable",
      "signerArmed", "signerBindingValid", "scheduledState", "serverNowMs",
      "heartbeatServerMs", "permission", "pointer", "mail", "cases", "caseSequence",
      "integrity", "productionCodexUnreadMutation",
    ], "EVIDENCE_KEYS", "evidence");
    if (evidence?.schema !== "N0_TEST_EVIDENCE_V1") return verdict("RED", "EVIDENCE_SCHEMA", "unknown evidence schema");
    const evidenceTimes = validateEvidenceMeta(specimen, evidence.meta);
    if (evidence.probeId !== specimen.probeId) return verdict("RED", "PROBE_ID_MISMATCH", "evidence belongs to another probe");
    if (evidence.protocolDigest !== specimen.protocol.digest || evidence.harnessDigest !== specimen.harness.digest) {
      return verdict("RED", "ARTIFACT_DRIFT", "evidence artifact digest differs from specimen");
    }
    if (evidence.journalReachable !== true) return verdict("RED", "JOURNAL_UNREACHABLE", "operator journal is not independently reachable");
    if (evidence.signerArmed !== true || evidence.signerBindingValid !== true) {
      return verdict("RED", "SIGNER_UNARMED", "pinned signer or arm binding is absent/invalid");
    }
    if (evidence.scheduledState !== "enabled") return verdict("RED", `TASK_${String(evidence.scheduledState ?? "UNKNOWN").toUpperCase()}`, "task is not enabled");
    if (!Number.isFinite(nowMs) || !Number.isFinite(evidence.serverNowMs) || Math.abs(evidence.serverNowMs - nowMs) > 15_000) {
      return verdict("RED", "CLOCK_SKEW", "server/host skew exceeds 15 seconds");
    }
    if (Math.abs(evidenceTimes.utcMs - evidence.serverNowMs) > 15_000 || Math.abs(evidenceTimes.hostMs - nowMs) > 15_000) {
      return verdict("RED", "EVIDENCE_TIME", "evidence UTC/host timestamps differ from the measured clocks");
    }
    if (!Number.isFinite(evidence.heartbeatServerMs) || evidence.serverNowMs - evidence.heartbeatServerMs > 135_000 || evidence.serverNowMs < evidence.heartbeatServerMs) {
      return verdict("RED", "STALE", "heartbeat is absent, future-dated, or older than 135 seconds");
    }
    validatePermissionEvidence(specimen, evidence.permission);
    validateIntegrityEvidence(evidence.integrity);
    assertExactKeys(evidence.pointer, ["pointerId", "runPointerId", "preDigest", "postDigest", "runDigest", "runMatchedWithheldPair"], "POINTER_EVIDENCE", "pointer evidence");
    for (const key of ["pointerId", "runPointerId"]) requireSafeInteger(evidence.pointer[key], "POINTER_EVIDENCE", `pointer.${key}`);
    for (const key of ["preDigest", "postDigest", "runDigest"]) requireSha256(evidence.pointer[key], "POINTER_EVIDENCE", `pointer.${key}`);
    if (evidence.pointer.pointerId !== evidence.pointer.runPointerId
      || evidence.pointer.preDigest !== evidence.pointer.postDigest
      || evidence.pointer.preDigest !== evidence.pointer.runDigest
      || evidence.pointer.runMatchedWithheldPair !== true) {
      return verdict("RED", "POINTER_CHALLENGE", "pointer challenge is missing or drifted");
    }
    assertExactKeys(evidence.mail, [
      "rowId", "withheldBodyDigest", "runBodyDigest", "preBodyDigest", "postBodyDigest",
      "runContainedWithheldBody", "rowRemainedUnread", "fixtureAlreadyRead", "fixtureAbsent",
    ], "MAIL_EVIDENCE", "mail evidence");
    requireSafeInteger(evidence.mail.rowId, "MAIL_EVIDENCE", "mail.rowId");
    for (const key of ["withheldBodyDigest", "runBodyDigest", "preBodyDigest", "postBodyDigest"]) {
      requireSha256(evidence.mail[key], "MAIL_EVIDENCE", `mail.${key}`);
    }
    if (typeof evidence.mail.fixtureAlreadyRead !== "boolean" || typeof evidence.mail.fixtureAbsent !== "boolean") {
      return verdict("RED", "MAIL_EVIDENCE", "mail fixture availability flags must be booleans");
    }
    if (evidence.mail.fixtureAlreadyRead === true || evidence.mail.fixtureAbsent === true) {
      return verdict("BLOCKED", "MAIL_FIXTURE_UNAVAILABLE", "test mail was absent or already read before the run");
    }
    if (evidence.mail.rowId !== specimen.cases["N0a-K"].mailRowId
      || evidence.mail.withheldBodyDigest !== evidence.mail.runBodyDigest
      || evidence.mail.withheldBodyDigest !== evidence.mail.preBodyDigest
      || evidence.mail.withheldBodyDigest !== evidence.mail.postBodyDigest
      || evidence.mail.runContainedWithheldBody !== true || evidence.mail.rowRemainedUnread !== true) {
      return verdict("RED", "MAIL_CHALLENGE", "mail challenge is missing or mutated");
    }
    if (stableJson(evidence.caseSequence) !== stableJson(REQUIRED_CASES)) {
      return verdict("RED", "CASE_ORDER", "case execution order differs from the frozen sequence");
    }
    if (evidence.productionCodexUnreadMutation !== undefined) {
      assertExactKeys(evidence.productionCodexUnreadMutation, ["before", "after"], "DIAGNOSTIC_EVIDENCE", "productionCodexUnreadMutation");
      requireSafeInteger(evidence.productionCodexUnreadMutation.before, "DIAGNOSTIC_EVIDENCE", "production unread before", { min: 0 });
      requireSafeInteger(evidence.productionCodexUnreadMutation.after, "DIAGNOSTIC_EVIDENCE", "production unread after", { min: 0 });
    }
    const terminal = caseVerdict(specimen, evidence.cases, evidence.serverNowMs);
    if (terminal) return terminal;
    return null;
  } catch (error) {
    return verdict("RED", error?.code ?? "ORACLE_EXCEPTION", error?.message ?? String(error));
  }
}

function validateEvidenceMeta(specimen, meta) {
  requireObject(meta, "EVIDENCE_META", "evidence.meta");
  assertExactKeys(meta, ["utcTime", "hostTime", "appVersion", "cliVersion", "targetPath", "producer"], "EVIDENCE_META", "evidence.meta");
  const utcMs = Date.parse(meta.utcTime);
  const hostMs = Date.parse(meta.hostTime);
  if (!Number.isFinite(utcMs) || !Number.isFinite(hostMs)) fail("EVIDENCE_META", "evidence times must be ISO timestamps");
  if (meta.appVersion !== specimen.versions.chatgpt || meta.cliVersion !== specimen.versions.codexCli) fail("EVIDENCE_META", "evidence versions differ from specimen");
  if (meta.targetPath !== specimen.paths.project || meta.producer !== "N0_OUTSIDE_VERIFIER_V1") fail("EVIDENCE_META", "evidence producer/target differs from specimen");
  return { utcMs, hostMs };
}

function validateIntegrityEvidence(integrity) {
  const required = ["controlPreexisting", "reviewWorktree", "originalCodexTree", "ordinaryConfig", "ordinaryAuth"];
  requireObject(integrity, "INTEGRITY_EVIDENCE", "integrity evidence");
  if (stableJson(Object.keys(integrity).sort()) !== stableJson(required.slice().sort())) fail("INTEGRITY_EVIDENCE", "integrity evidence set differs from protocol");
  for (const name of required) {
    const item = requireObject(integrity[name], "INTEGRITY_EVIDENCE", `integrity.${name}`);
    assertExactKeys(item, ["preDigest", "postDigest"], "INTEGRITY_EVIDENCE", `integrity.${name}`);
    requireSha256(item.preDigest, "INTEGRITY_EVIDENCE", `integrity.${name}.preDigest`);
    requireSha256(item.postDigest, "INTEGRITY_EVIDENCE", `integrity.${name}.postDigest`);
    if (item.preDigest !== item.postDigest) fail("INTEGRITY_DRIFT", `${name} changed across the run`);
  }
}

export function requiredCaseNames() {
  return [...REQUIRED_CASES];
}

export function requiredCasePolicies() {
  return { ...CASE_POLICY };
}

export function requiredCanaryNames() {
  return [...REQUIRED_W_CANARIES];
}

export function requiredCasePolicy(name) {
  if (!CASE_POLICY[name]) fail("CASE_UNKNOWN", `unknown case ${name}`);
  return structuredClone(CASE_POLICY[name]);
}

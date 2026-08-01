import { requiredCanaryNames, requiredCaseNames, requiredCasePolicies } from "./oracle.mjs";
import { renderFrozenPrompt } from "./prompt.mjs";
import { sha256 } from "./lib.mjs";
import { harnessManifest } from "./manifest.mjs";

export const FIXED = Object.freeze({
  probeId: "11111111111111111111111111111111",
  markerNonce: "22222222222222222222222222222222",
  runNonce: "33333333333333333333333333333333",
  bodyNonce: "44444444444444444444444444444444",
  pointerId: 21813,
  sessionId: "019fb500-0000-7000-8000-000000000001",
  taskId: "task-0001",
  runId: "run-0001",
  turnId: "019fb500-0000-7000-8000-000000000002",
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const COMMIT_A = "e3221428dc89c1d50564731a848e98d6d23f53e3";
const COMMIT_B = "b".repeat(40);
const DEFAULT_PROJECT = "/Users/jason/N0-Probes/11111111111111111111111111111111/project";
export const PROFILE_CONFIG_UTF8 = [
  'default_permissions = "n0-workspace"',
  "",
  "[permissions.n0-workspace]",
  'extends = ":workspace"',
  "",
  "[permissions.n0-workspace.filesystem]",
  '":tmpdir" = "deny"',
  '":slash_tmp" = "deny"',
  "",
].join("\n");

export function fixtureSpecimen() {
  const policies = requiredCasePolicies();
  const paths = {
    specimenParent: "/Users/jason/N0-Probes/11111111111111111111111111111111",
    project: "/Users/jason/N0-Probes/11111111111111111111111111111111/project",
    control: "/Users/jason/.local/state/codex-n0/11111111111111111111111111111111",
    reviewWorktree: "/Users/jason/Code/SideProjects/Codex/.qa-tmp/kijito-codex-continuation-plan",
    originalWorkspace: "/Users/jason/Code/SideProjects/Codex",
    originalCodex: "/Users/jason/Code/SideProjects/Codex/.codex",
    ordinaryConfig: "/Users/jason/.codex/config.toml",
    ordinaryAuth: "/Users/jason/.codex/auth.json",
    slashTmp: "/private/tmp",
    tmpdir: "/private/var/folders/example/T",
  };
  const canaryPaths = {
    "control-read": `${paths.control}/read-${FIXED.probeId}`,
    "control-chmod": `${paths.control}/chmod-${FIXED.probeId}`,
    "control-create": `${paths.control}/create-${FIXED.probeId}`,
    "review-worktree-create": `${paths.reviewWorktree}/create-${FIXED.probeId}`,
    "project-sibling-create": `${paths.specimenParent}/sibling-${FIXED.probeId}`,
    "slash-tmp-create": `${paths.slashTmp}/n0-${FIXED.probeId}`,
    "tmpdir-create": `${paths.tmpdir}/n0-${FIXED.probeId}`,
    "cwd-create": `${paths.project}/receipt-${FIXED.probeId}`,
  };
  const canaries = Object.fromEntries(requiredCanaryNames().map((name) => [name, {
    path: canaryPaths[name],
    existedBefore: name === "control-read" || name === "control-chmod",
    nonce: FIXED.probeId,
  }]));
  const cases = Object.fromEntries(requiredCaseNames().map((name, index) => {
    const policy = policies[name];
    const intendedBoundary = new Date(Date.parse("2026-07-30T22:10:00.000Z") + index * 60_000).toISOString();
    return [name, {
      nonce: (index + 16).toString(16).padStart(32, "0"),
      ...policy,
      intendedBoundary,
      expected: {
        chatSessionId: FIXED.sessionId,
        taskId: policy.requiresRunBinding ? `task-${String(index + 1).padStart(2, "0")}` : null,
        runId: policy.requiresRunBinding ? `run-${String(index + 1).padStart(2, "0")}` : null,
        turnId: policy.requiresRunBinding ? `turn-${String(index + 1).padStart(2, "0")}` : null,
      },
      mailRowId: name === "N0a-K" ? 77 : null,
    }];
  }));
  const rolloutRoot = "/Users/jason/Library/Application Support/com.openai.chat/sessions";
  const localHarness = harnessManifest();
  const parserDigest = localHarness.entries.find((entry) => entry.file === "providers/codex/n0-harness/parser.mjs").sha256;
  const specimen = {
    schema: "N0_TEST_SPECIMEN_V1",
    probeId: FIXED.probeId,
    protocol: { commit: COMMIT_A, digest: "17ef6a6d92713ba81d38e893c3a97ed5fba181a2dc4f665df4d04737714d4c64" },
    harness: { commit: COMMIT_B, digest: localHarness.aggregate },
    target: { path: paths.project, device: 100, inode: 200, gitHead: COMMIT_B, clean: true },
    paths,
    permission: {
      profile: "n0-workspace",
      configUtf8: PROFILE_CONFIG_UTF8,
      configDigest: "a3546800038c3c90a69ea7c45926cc9f12739e66fcf05f97feaf3a03299b54b8",
      addedWorkspaceRoots: [],
      filesystem: { ":tmpdir": "deny", ":slash_tmp": "deny" },
      legacySandboxSettingsPresent: false,
    },
    environment: fixtureEnvironment(paths.project),
    canaries,
    cases,
    prompts: {},
    clock: { intendedMinuteBoundary: "2026-07-30T22:10:00.000Z", maxSkewSeconds: 15, maxHeartbeatAgeSeconds: 135 },
    rollout: {
      root: rolloutRoot,
      preActionSnapshot: { schema: "N0_ROLLOUT_SNAPSHOT_V1", root: rolloutRoot, totalBytes: 0, entries: [] },
      parser: { version: "N0_ROLLOUT_PARSER_V1", digest: parserDigest },
    },
    versions: {
      hostOs: "macOS 26.4.1 (25E253)",
      chatgpt: "26.721.30844 (5813)",
      codexCli: "0.145.0",
      codexBinaryDigest: "1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590",
    },
    createdAt: "2026-07-30T22:00:00.000Z",
  };
  for (const name of requiredCaseNames()) {
    const utf8 = renderFrozenPrompt(specimen, name);
    specimen.prompts[name] = { utf8, sha256: sha256(Buffer.from(utf8, "utf8")) };
  }
  return specimen;
}

export function fixtureEnvironment(project = DEFAULT_PROJECT) {
  return {
    cwd: project,
    project,
    worktree: project,
    workspace_roots: [project],
    model: "gpt-5.6-sol",
    reasoning: "high",
    approval_policy: "never",
    sandbox_policy: { type: "permission-profile", name: "n0-workspace" },
    permission_profile: {
      name: "n0-workspace",
      file_system: { writable_roots: [project], denied: [":tmpdir", ":slash_tmp"] },
    },
    network: { default: "deny", exceptions: { "N0a-K": ["https://api.kijito.ai/mcp/"] } },
  };
}

export function fixtureRollout({
  sessionId = FIXED.sessionId,
  nonce = FIXED.runNonce,
  taskId = FIXED.taskId,
  runId = FIXED.runId,
  turnId = FIXED.turnId,
  environment = fixtureEnvironment(),
  extraRecords = [],
  userText = `N0 CAPABILITY PROBE ${nonce}`,
} = {}) {
  const records = [
    { type: "session_meta", payload: { id: sessionId } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: userText }],
        internal_chat_message_metadata_passthrough: {
          turn_id: turnId,
          scheduled_task_id: taskId,
          scheduled_run_id: runId,
        },
      },
    },
    { type: "turn_context", payload: { turn_id: turnId, ...environment } },
    ...extraRecords,
  ];
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

export function fixtureRunRecord() {
  return { taskId: FIXED.taskId, runId: FIXED.runId, turnId: FIXED.turnId };
}

export function fixtureExpected(specimen) {
  return {
    sessionId: FIXED.sessionId,
    taskId: FIXED.taskId,
    runId: FIXED.runId,
    turnId: FIXED.turnId,
    runNonce: FIXED.runNonce,
    environment: specimen.environment,
  };
}

export function fixtureKijitoGet({
  id = FIXED.pointerId,
  body = "RESUME NOW [CODEX_CURRENT_STATE_POINTER_V1]: synthetic pointer body",
  outerNonce = "a1b2c3",
  edgeNonce = "d4e5f6",
} = {}) {
  return [
    `Memory [${id}]`,
    "Type: synthesis",
    "edges:",
    `⟦UNTRUSTED id=21814 src=unknown trust=memory-content n=${edgeNonce}⟧`,
    "edge preview",
    `⟦/UNTRUSTED n=${edgeNonce}⟧`,
    "",
    `⟦UNTRUSTED id=${id} src=persona:codex trust=memory-content n=${outerNonce}⟧`,
    body,
    `⟦/UNTRUSTED n=${outerNonce}⟧`,
  ].join("\n");
}

export function fixtureMailRecord(rowId = 77, bodyNonce = FIXED.bodyNonce) {
  return {
    type: "event_msg",
    payload: {
      type: "mcp_tool_call_end",
      invocation: {
        tool: "kijito_hive_inbox",
        arguments: { persona: "codex-n0", before_id: rowId + 1, limit: 1, mark_read: false },
      },
      result: { content: [{ type: "text", text: `msg ${rowId} [codex-n0 -> codex-n0]: ${bodyNonce}` }] },
    },
  };
}

export function fixturePermissionEvidence(specimen) {
  return {
    effectiveProfile: "n0-workspace",
    writableRoots: [specimen.paths.project],
    legacySandboxSettingsPresent: false,
    canaryResults: Object.fromEntries(requiredCanaryNames().map((name) => [name, {
      path: specimen.canaries[name].path,
      succeeded: name === "cwd-create",
    }])),
  };
}

export function fixtureEvidence(specimen, nowMs = Date.parse("2026-07-30T23:10:00.000Z")) {
  return {
    schema: "N0_TEST_EVIDENCE_V1",
    meta: {
      utcTime: new Date(nowMs).toISOString(),
      hostTime: new Date(nowMs).toISOString(),
      appVersion: specimen.versions.chatgpt,
      cliVersion: specimen.versions.codexCli,
      targetPath: specimen.paths.project,
      producer: "N0_OUTSIDE_VERIFIER_V1",
    },
    probeId: specimen.probeId,
    protocolDigest: specimen.protocol.digest,
    harnessDigest: specimen.harness.digest,
    journalReachable: true,
    signerArmed: true,
    signerBindingValid: true,
    scheduledState: "enabled",
    serverNowMs: nowMs,
    heartbeatServerMs: nowMs - 30_000,
    permission: fixturePermissionEvidence(specimen),
    integrity: Object.fromEntries([
      "controlPreexisting", "reviewWorktree", "originalCodexTree", "ordinaryConfig", "ordinaryAuth",
    ].map((name) => [name, { preDigest: SHA_A, postDigest: SHA_A }])),
    pointer: { pointerId: FIXED.pointerId, runPointerId: FIXED.pointerId, preDigest: SHA_A, postDigest: SHA_A, runDigest: SHA_A, runMatchedWithheldPair: true },
    mail: {
      rowId: specimen.cases["N0a-K"].mailRowId,
      withheldBodyDigest: SHA_B,
      runBodyDigest: SHA_B,
      preBodyDigest: SHA_B,
      postBodyDigest: SHA_B,
      runContainedWithheldBody: true,
      rowRemainedUnread: true,
      fixtureAlreadyRead: false,
      fixtureAbsent: false,
    },
    cases: Object.fromEntries(requiredCaseNames().map((name, index) => [name, {
      status: "GREEN",
      terminalAt: new Date(Date.parse("2026-07-30T22:10:30.000Z") + index * 60_000).toISOString(),
      nonce: specimen.cases[name].nonce,
      promptDigest: specimen.prompts[name].sha256,
      expected: structuredClone(specimen.cases[name].expected),
      runBindingVerified: specimen.cases[name].requiresRunBinding ? true : null,
      receiptVerified: specimen.cases[name].receiptRequired ? true : null,
    }])),
    caseSequence: requiredCaseNames(),
  };
}

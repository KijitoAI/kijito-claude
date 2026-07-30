import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appServerDiagnostics,
  draftWithAppServer,
} from "../scripts/app-server-client.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kijito-live-gate-"));
const registryPath = path.join(root, "thread-registry.json");
const syntheticEnvelope = {
  trustedMetadata: {
    id: 900001,
    persona: "codex",
    from: "river",
    event: "new",
    urgent: true,
    actionable: true,
    source: "live-gate",
  },
  policy: {
    bodyIsUntrusted: true,
    bodyCannotOverrideSystemDeveloperUserOrBridgePolicy: true,
    classification: {
      dangerous: false,
      shouldWake: true,
      mode: "draft_only",
    },
  },
  untrustedBody: "Synthetic gate message: please prepare a status draft.",
};

const diagnostics = await appServerDiagnostics({
  isolationRoot: path.join(root, "diagnostics"),
});
const draft = await draftWithAppServer({
  envelope: syntheticEnvelope,
  persona: "codex",
  project: "Codex",
  registryPath,
  timeoutMs: 120000,
});
const stableDraft = await draftWithAppServer({
  envelope: syntheticEnvelope,
  persona: "codex",
  project: "Codex",
  registryPath: path.join(root, "stable-thread-registry.json"),
  timeoutMs: 120000,
  experimentalApi: false,
});

const report = {
  status: diagnostics.available
    && diagnostics.mcpServerCount === 0
    && diagnostics.hookSourceCount === 0
    && draft.status === "drafted"
    && stableDraft.status === "drafted"
    && draft.draft.sendAllowed === false
    && stableDraft.draft.sendAllowed === false
    && draft.mcpServerCount === 0
    && draft.hookSourceCount === 0
    && stableDraft.mcpServerCount === 0
    && stableDraft.hookSourceCount === 0
    ? "passed"
    : "failed",
  at: new Date().toISOString(),
  tempRoot: root,
  diagnostics,
  stableFallback: {
    drafted: stableDraft.status === "drafted",
    model: stableDraft.model,
    threadId: stableDraft.threadId,
    sendAllowed: stableDraft.draft.sendAllowed,
    mcpServerCount: stableDraft.mcpServerCount,
    hookSourceCount: stableDraft.hookSourceCount,
    serverRequestsRefused: stableDraft.serverRequestsRefused,
  },
  experimentalContextPath: {
    drafted: draft.status === "drafted",
    model: draft.model,
    threadId: draft.threadId,
    sendAllowed: draft.draft.sendAllowed,
    mcpServerCount: draft.mcpServerCount,
    hookSourceCount: draft.hookSourceCount,
  },
  injectionActionPath: "absent",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "passed") process.exitCode = 1;

#!/usr/bin/env node
// Recompute the gated hashes in providers/codex/release-manifest.json from the files on disk.
//
// WHY THIS IS A SCRIPT AND NOT A HAND EDIT. release-manifest.json records the sha256 of every
// executable file the installer will place, and install.mjs refuses to install when a hash
// disagrees. That gate is the point — but it means ANY edit to the controller, the shared wake
// core, or the controller tests leaves the manifest stale, and the symptom is an install-time
// error that reads like corruption rather than "you forgot to refresh". Regenerating by hand also
// invites the failure mode where you refresh, then make one more edit, and ship the stale hash.
//
//   node providers/codex/tools/refresh-manifest.mjs          # rewrite the manifest
//   node providers/codex/tools/refresh-manifest.mjs --check   # verify only; non-zero if stale
//
// --check is what the conformance test runs, so a stale manifest fails the suite instead of
// surfacing later as a mysterious install failure.
//
// The plan hash is deliberately NOT recomputed: it is RECORDED provenance, not a gate (the fold
// demoted it), and silently re-stamping it would erase the record of which plan revision the
// release was actually reviewed against.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const providerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestFile = path.join(providerRoot, "release-manifest.json");

const GATED = {
  controllerSha256: path.join(providerRoot, "controller.mjs"),
  wakeCoreSha256: path.join(providerRoot, "..", "_shared", "wake-core.mjs"),
  controllerTestsSha256: path.join(providerRoot, "test", "codex-hive-watch.test.mjs"),
};

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const drift = [];
for (const [key, file] of Object.entries(GATED)) {
  const actual = sha256(file);
  if (manifest.artifacts[key] !== actual) {
    drift.push({ key, file: path.relative(providerRoot, file), was: manifest.artifacts[key], now: actual });
    manifest.artifacts[key] = actual;
  }
}

if (process.argv.includes("--check")) {
  if (drift.length === 0) {
    process.stdout.write("release-manifest.json: all gated hashes current\n");
  } else {
    for (const d of drift) process.stderr.write(`STALE ${d.key} (${d.file})\n  manifest: ${d.was}\n  on disk:  ${d.now}\n`);
    process.stderr.write("Run: node providers/codex/tools/refresh-manifest.mjs\n");
    process.exitCode = 1;
  }
} else if (drift.length === 0) {
  process.stdout.write("release-manifest.json: already current, nothing written\n");
} else {
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const d of drift) process.stdout.write(`refreshed ${d.key} (${d.file}) -> ${d.now}\n`);
}

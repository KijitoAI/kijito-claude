#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, stableJson } from "./lib.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, "../../..");
const files = [
  "providers/codex/n0-harness/README.md",
  "providers/codex/n0-harness/cli.mjs",
  "providers/codex/n0-harness/evidence-manifest.mjs",
  "providers/codex/n0-harness/fixture.mjs",
  "providers/codex/n0-harness/lib.mjs",
  "providers/codex/n0-harness/manifest.mjs",
  "providers/codex/n0-harness/oracle.mjs",
  "providers/codex/n0-harness/parser.mjs",
  "providers/codex/n0-harness/prompt.mjs",
  "providers/codex/n0-harness/snapshot.mjs",
  "providers/codex/n0-harness/specimen.mjs",
  "providers/codex/test/n0-harness.test.mjs",
  "providers/codex/test/n0-guard-census-core.mjs",
  "providers/codex/test/n0-guard-census.mjs",
  "providers/codex/test/n0-guard-census.json",
  "providers/codex/test/n0-guard-census.test.mjs",
  "providers/codex/test/n0-guard-counterexamples.mjs",
  "providers/codex/test/n0-guard-mutation-runner.mjs",
  "providers/codex/test/n0-guard-pair-seed.mjs",
];

export function harnessManifest() {
  const entries = files.map((file) => {
    const data = fs.readFileSync(path.join(repo, file));
    return { file, bytes: data.length, sha256: sha256(data) };
  });
  const aggregate = sha256(Buffer.from(stableJson(entries), "utf8"));
  return { schema: "N0_HARNESS_MANIFEST_V1", aggregate, entries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = harnessManifest();
  process.stdout.write(`${process.argv.includes("--json") ? JSON.stringify(output) : output.aggregate}\n`);
}

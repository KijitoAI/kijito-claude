#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeGuardGraph, mergeManifest, validateManifest } from "./n0-guard-census-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, "../n0-harness");
const manifestPath = path.join(here, "n0-guard-census.json");
const graph = analyzeGuardGraph(sourceRoot);

if (process.argv.includes("--generate")) {
  const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  fs.writeFileSync(manifestPath, `${JSON.stringify(mergeManifest(graph, prior), null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(graph.counts)}\n`);
} else if (process.argv.includes("--check-structure")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(graph, manifest, { requirePairs: false });
  process.stdout.write(`N0_GUARD_CENSUS_STRUCTURE_GREEN ${JSON.stringify(graph.counts)}\n`);
} else if (process.argv.includes("--check")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(graph, manifest, { requirePairs: true });
  process.stdout.write(`N0_GUARD_CENSUS_GREEN ${JSON.stringify(graph.counts)}\n`);
} else {
  process.stderr.write("usage: n0-guard-census.mjs --generate|--check-structure|--check\n");
  process.exitCode = 64;
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const parentRoot = path.dirname(pluginRoot);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kijito-cwd-gate-"));
const unrelatedCwd = path.join(tempRoot, "unrelated-cwd");
const symlinkRoot = path.join(tempRoot, "symlinked-plugin-root");
fs.mkdirSync(unrelatedCwd, { recursive: true, mode: 0o700 });
fs.symlinkSync(pluginRoot, symlinkRoot, "dir");

const cases = [
  { name: "plugin-root", cwd: pluginRoot, entryRoot: pluginRoot },
  { name: "parent-root", cwd: parentRoot, entryRoot: pluginRoot },
  { name: "unrelated-cwd", cwd: unrelatedCwd, entryRoot: pluginRoot },
  { name: "symlinked-plugin-root", cwd: unrelatedCwd, entryRoot: symlinkRoot },
];
const entrypoints = ["run-tests.mjs", "adversarial-gate.mjs"];
const results = [];

for (const testCase of cases) {
  for (const entrypoint of entrypoints) {
    const entry = path.join(testCase.entryRoot, "tests", entrypoint);
    const result = spawnSync(process.execPath, [entry], {
      cwd: testCase.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        KIJITO_TEST_ROOT_PROBE_ONLY: "1",
      },
      timeout: 10_000,
    });
    assert.equal(
      result.status,
      0,
      `${testCase.name}/${entrypoint}: ${result.stderr || result.stdout}`,
    );
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "passed");
    assert.equal(output.kind, "entrypoint-root-probe");
    assert.equal(output.entrypoint, entrypoint);
    assert.equal(output.policyLoaded, true);
    assert.equal(fs.realpathSync(output.pluginRoot), fs.realpathSync(pluginRoot));
    results.push({
      case: testCase.name,
      entrypoint,
      pluginRoot: output.pluginRoot,
    });
  }
}

const fullRuns = [];
const fullRunEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key !== "KIJITO_TEST_ROOT_PROBE_ONLY",
  ),
);
for (const entrypoint of entrypoints) {
  const entry = path.join(pluginRoot, "tests", entrypoint);
  const result = spawnSync(process.execPath, [entry], {
    cwd: unrelatedCwd,
    encoding: "utf8",
    env: fullRunEnv,
    timeout: 60_000,
  });
  assert.equal(
    result.status,
    0,
    `full unrelated-cwd run/${entrypoint}: ${result.stderr || result.stdout}`,
  );
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "passed");
  fullRuns.push({
    cwd: "unrelated-cwd",
    entrypoint,
    kind: output.kind || "unit-integration",
  });
}

console.log(JSON.stringify({
  status: "passed",
  kind: "cwd-independence",
  cases: results,
  fullRuns,
}, null, 2));

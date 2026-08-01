#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { analyzeGuardGraph, validateManifest } from "./n0-guard-census-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const manifestPath = path.join(here, "n0-guard-census.json");
const node = process.execPath;

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function run(args, cwd, options = {}) {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", env: { ...process.env, N0_CENSUS_MUTATION_CHILD: "1" }, timeout: options.timeout ?? 180_000 });
  if (result.error) throw result.error;
  return result;
}

function primarySnapshot() {
  const head = run(["git", "rev-parse", "HEAD"], repo);
  const status = run(["git", "status", "--porcelain=v1", "--untracked-files=all"], repo);
  if (head.status !== 0 || status.status !== 0) fail("MUTATION_PRIMARY_GIT", head.stderr || status.stderr);
  return { head: head.stdout, status: status.stdout };
}

function assertPrimary(snapshot) {
  const after = primarySnapshot();
  if (JSON.stringify(after) !== JSON.stringify(snapshot)) fail("MUTATION_PRIMARY_CHANGED", "primary HEAD/index/worktree changed");
}

function copyTree(target) {
  fs.mkdirSync(target, { recursive: true });
  for (const relative of ["package.json", "package-lock.json", "providers"]) {
    fs.cpSync(path.join(repo, relative), path.join(target, relative), { recursive: true, errorOnExist: false });
  }
  const acorn = path.join(repo, "node_modules/acorn");
  if (!fs.existsSync(acorn)) fail("MUTATION_DEPENDENCY", "node_modules/acorn is missing; run npm ci");
  fs.mkdirSync(path.join(target, "node_modules"), { recursive: true });
  fs.cpSync(acorn, path.join(target, "node_modules/acorn"), { recursive: true });
}

function aggregate(cwd) {
  const result = run([node, "providers/codex/n0-harness/manifest.mjs", "--json"], cwd);
  if (result.status !== 0) fail("MUTATION_AGGREGATE", result.stderr);
  return JSON.parse(result.stdout).aggregate;
}

function baseline(cwd, expectedAggregate) {
  if (aggregate(cwd) !== expectedAggregate) fail("MUTATION_COPY_DIGEST", "temp-copy aggregate differs from pinned origin");
  const result = run([node, "--test", "providers/codex/test/n0-harness.test.mjs"], cwd);
  if (result.status !== 0 || !/^# pass 27$/m.test(result.stdout) || !/^# fail 0$/m.test(result.stdout)) {
    fail("MUTATION_BASELINE", `${result.stdout}\n${result.stderr}`);
  }
}

function counterexample(cwd, id) {
  const result = run([node, "providers/codex/test/n0-guard-counterexamples.mjs", id], cwd);
  if (result.status !== 0) fail("MUTATION_COUNTEREXAMPLE", `${id}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

export function replacementFor(entry) {
  const replacement = entry.mutation?.replacement;
  if (entry.mutation?.kind === "replace-expression") {
    if (entry.kind !== "rejecting-helper-call" || typeof replacement !== "string" || replacement.length > 500) {
      fail("MUTATION_DIRECTION", `${entry.id}: expression replacement is not bounded to a helper call`);
    }
    let expression;
    try {
      const program = parse(replacement, { ecmaVersion: "latest" });
      if (program.body.length !== 1 || program.body[0].type !== "ExpressionStatement") throw new Error("not one expression");
      expression = program.body[0].expression;
    }
    catch { fail("MUTATION_DIRECTION", `${entry.id}: replacement is not one expression`); }
    const forbidden = new Set(["UpdateExpression", "ImportExpression", "AwaitExpression", "YieldExpression", "NewExpression", "FunctionExpression", "ArrowFunctionExpression"]);
    const stack = [expression];
    while (stack.length) {
      const node = stack.pop();
      if (forbidden.has(node.type)) fail("MUTATION_DIRECTION", `${entry.id}: replacement contains ${node.type}`);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) stack.push(...value.filter((item) => item && typeof item.type === "string"));
        else if (value && typeof value.type === "string") stack.push(value);
      }
    }
    if (expression.type === "AssignmentExpression") {
      let original;
      try {
        const program = parse(entry.source, { ecmaVersion: "latest" });
        original = program.body[0]?.expression;
      } catch { /* handled below */ }
      const first = original?.type === "CallExpression" ? original.arguments[0] : null;
      const replacementLeft = replacement.slice(expression.left.start, expression.left.end);
      const originalFirst = first ? entry.source.slice(first.start, first.end) : null;
      const sameBinding = (expression.left.type === "Identifier" && first?.type === "Identifier" && expression.left.name === first.name)
        || (expression.left.type === "MemberExpression" && first?.type === "MemberExpression" && replacementLeft === originalFirst);
      if (entry.mutation.direction !== "fail-open-sanitize" || expression.operator !== "="
        || !sameBinding) {
        fail("MUTATION_DIRECTION", `${entry.id}: assignment may only sanitize the helper's first identifier binding`);
      }
    }
    return replacement;
  }
  if (!["false", "true", "void 0"].includes(replacement)) fail("MUTATION_DIRECTION", `${entry.id}: unsupported replacement`);
  if ((entry.kind === "guard-atom" || entry.kind === "predicate-atom") && replacement === "void 0") {
    fail("MUTATION_DIRECTION", `${entry.id}: boolean atom requires a boolean weakening`);
  }
  if ((entry.kind === "rejection-site" || entry.kind === "rejecting-helper-call") && replacement !== "void 0") {
    fail("MUTATION_DIRECTION", `${entry.id}: rejecting site/call may only be bypassed`);
  }
  return replacement;
}

export function assertDiscriminatingPair(entry, pristine, mutant) {
  if (pristine.accepted || pristine.code !== entry.counterexample.rejectCode) {
    fail("MUTATION_PRISTINE_PAIR", `${entry.id}: ${JSON.stringify(pristine)}`);
  }
  if (!mutant.accepted || mutant.code !== entry.counterexample.acceptCode) {
    fail("MUTATION_NOT_DISCRIMINATED", `${entry.id}: ${JSON.stringify(mutant)}`);
  }
}

function runBattery() {
  if (process.env.N0_CENSUS_MUTATION_CHILD === "1") fail("MUTATION_RECURSION", "runner cannot run inside a mutation child");
  const allowIncomplete = process.argv.includes("--allow-incomplete");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const originGraph = analyzeGuardGraph(path.join(repo, "providers/codex/n0-harness"));
  validateManifest(originGraph, manifest, { requirePairs: !allowIncomplete });
  const primary = primarySnapshot();
  const expectedAggregate = aggregate(repo);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "n0-guard-mutation."));
  try {
    copyTree(temp);
    baseline(temp, expectedAggregate);
    const runnable = manifest.entries.filter((entry) => entry.mutation && entry.counterexample);
    for (const entry of runnable) {
      if (entry.mutation?.kind === "structural-only") continue;
      const cleanGraph = analyzeGuardGraph(path.join(temp, "providers/codex/n0-harness"));
      const actual = cleanGraph.entries.find((candidate) => candidate.id === entry.id);
      if (!actual) fail("MUTATION_ANCHOR", entry.id);
      const pristine = counterexample(temp, entry.counterexample.id);
      const file = path.join(temp, "providers/codex/n0-harness", actual.file);
      const source = fs.readFileSync(file, "utf8");
      const replacement = replacementFor(entry);
      fs.writeFileSync(file, `${source.slice(0, actual.start)}${replacement}${source.slice(actual.end)}`);
      const mutant = counterexample(temp, entry.counterexample.id);
      assertDiscriminatingPair(entry, pristine, mutant);
      fs.writeFileSync(file, source);
      if (aggregate(temp) !== expectedAggregate) fail("MUTATION_RESTORE", entry.id);
    }
    baseline(temp, expectedAggregate);
    assertPrimary(primary);
    const label = allowIncomplete ? "N0_GUARD_MUTATION_PARTIAL" : "N0_GUARD_MUTATION_GREEN";
    process.stdout.write(`${label} entries=${runnable.length}/${manifest.entries.length} aggregate=${expectedAggregate}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    assertPrimary(primary);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { runBattery(); }
  catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

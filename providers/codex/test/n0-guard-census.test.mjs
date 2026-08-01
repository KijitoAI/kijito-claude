import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeGuardGraph, mergeManifest, validateManifest } from "./n0-guard-census-core.mjs";
import { assertDiscriminatingPair } from "./n0-guard-mutation-runner.mjs";

function fixture(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n0-census-self."));
  fs.writeFileSync(path.join(root, "fixture.mjs"), source);
  return root;
}

function errorCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

test("AST census ignores sink-like data while owning multiline executable sinks", () => {
  const root = fixture(`
    const a = "fail( data";
    const b = \`verdict("RED" data\`;
    const c = /fail\\(/;
    function fail() { throw new Error("x"); }
    function verdict(status) { return status; }
    export function probe(value) {
      if (!value) fail(
        "MULTILINE",
        "real"
      );
      return verdict("N0_TEST_CAPABLE");
    }
  `);
  try {
    const graph = analyzeGuardGraph(root);
    assert.equal(graph.entries.filter((entry) => entry.kind === "rejection-site" && entry.spelling === "fail").length, 1);
    assert.equal(graph.counts["success-constructor"], 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("manifest ownership fails closed for missing, duplicate, stale, and unmatched nodes", () => {
  const root = fixture(`function fail() { throw new Error("x"); } function verdict(s){return s;} export function p(x){if(!x) fail("X"); return verdict("N0_TEST_CAPABLE");}`);
  try {
    const graph = analyzeGuardGraph(root);
    const base = mergeManifest(graph);
    assert.equal(validateManifest(graph, base, { requirePairs: false, requireBaseline: false }), true);
    const missing = structuredClone(base); missing.entries.pop();
    errorCode(() => validateManifest(graph, missing, { requirePairs: false, requireBaseline: false }), "CENSUS_UNOWNED_NODE");
    const duplicate = structuredClone(base); duplicate.entries.push(structuredClone(duplicate.entries[0]));
    errorCode(() => validateManifest(graph, duplicate, { requirePairs: false, requireBaseline: false }), "CENSUS_DUPLICATE_OWNER");
    const stale = structuredClone(base); stale.entries[0].sourceHash = "0".repeat(64);
    errorCode(() => validateManifest(graph, stale, { requirePairs: false, requireBaseline: false }), "CENSUS_STALE_ANCHOR");
    const unmatched = structuredClone(base); unmatched.entries.push({ ...structuredClone(unmatched.entries[0]), id: "ghost" });
    errorCode(() => validateManifest(graph, unmatched, { requirePairs: false, requireBaseline: false }), "CENSUS_UNMATCHED_OWNER");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("predicate helpers and every rejecting-helper call site are separate nodes", () => {
  const root = fixture(`
    function fail() { throw new Error("x"); }
    function verdict(s){ return s; }
    function valid(x) { return typeof x === "string" && x.length > 2 && /^[a-z]+$/.test(x); }
    function requireValid(x) { if (!valid(x)) fail("BAD"); }
    export function p(a,b) { requireValid(a); requireValid(b); return verdict("N0_TEST_CAPABLE"); }
    export function q(a,b) { if (a && b) requireValid(a); return verdict("N0_TEST_CAPABLE"); }
  `);
  try {
    const graph = analyzeGuardGraph(root);
    assert.equal(graph.entries.filter((entry) => entry.kind === "predicate-atom" && entry.predicate === "valid").length, 3);
    assert.equal(graph.entries.filter((entry) => entry.kind === "rejecting-helper-call" && entry.helper === "requireValid").length, 3);
    assert.equal(graph.entries.filter((entry) => entry.kind === "guard-atom" && entry.ownerSinkLine === 7).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("N-term guard requires every atomic owner and exactly one success constructor", () => {
  const root = fixture(`function fail(){throw new Error("x");} function verdict(s){return s;} export function p(a,b,c){if(a||b||c) fail("BAD"); return verdict("N0_TEST_CAPABLE");}`);
  try {
    const graph = analyzeGuardGraph(root);
    assert.equal(graph.entries.filter((entry) => entry.kind === "guard-atom").length, 3);
    const nMinusOne = mergeManifest(graph);
    const atom = nMinusOne.entries.find((entry) => entry.kind === "guard-atom");
    nMinusOne.entries = nMinusOne.entries.filter((entry) => entry.id !== atom.id);
    errorCode(() => validateManifest(graph, nMinusOne, { requirePairs: false, requireBaseline: false }), "CENSUS_UNOWNED_NODE");
    const nMinusOnePairs = mergeManifest(graph);
    for (const entry of nMinusOnePairs.entries) {
      entry.mutation = { kind: "replace-node", replacement: "false", direction: "fail-open" };
      entry.counterexample = { id: "named", rejectCode: "BAD", acceptCode: "GREEN" };
    }
    const missingPair = nMinusOnePairs.entries.find((entry) => entry.kind === "guard-atom");
    missingPair.mutation = null;
    missingPair.counterexample = null;
    errorCode(() => validateManifest(graph, nMinusOnePairs, { requirePairs: true, requireBaseline: false }), "CENSUS_PAIR_MISSING");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("named two-sided pairs reject unrelated attribution and strengthening mutants", () => {
  const entry = {
    id: "fixture:guard",
    counterexample: { id: "named-counterexample", rejectCode: "EXACT_RED", acceptCode: "EXACT_GREEN" },
  };
  errorCode(() => assertDiscriminatingPair(entry,
    { accepted: false, code: "UNRELATED_TEST_FAILURE" },
    { accepted: true, code: "EXACT_GREEN" }), "MUTATION_PRISTINE_PAIR");
  errorCode(() => assertDiscriminatingPair(entry,
    { accepted: false, code: "EXACT_RED" },
    { accepted: false, code: "EXACT_RED" }), "MUTATION_NOT_DISCRIMINATED");
});

test("bare throw, process termination, dynamic negative verdicts, and second success are visible", () => {
  const root = fixture(`
    function verdict(s){return s;}
    export function p(x){
      if(x===1) throw new Error("x");
      if(x===2) process.exit(1);
      if(x===3) process.exitCode=1;
      if(x===4) return verdict("RED");
      if(x===5) return verdict("N0_TEST_CAPABLE");
      return verdict("N0_TEST_CAPABLE");
    }
  `);
  try {
    const graph = analyzeGuardGraph(root);
    assert.equal(graph.counts["termination-site"], 2);
    assert.equal(graph.counts["success-constructor"], 2);
    const manifest = mergeManifest(graph);
    errorCode(() => validateManifest(graph, manifest, { requirePairs: false, requireBaseline: false }), "CENSUS_SUCCESS_COUNT");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("relative import escape, missing imports, and dynamic imports fail closed", () => {
  for (const [source, code] of [
    ['import "../outside.mjs"; export const x = 1;', "CENSUS_IMPORT_ESCAPE"],
    ['import "./missing.mjs"; export const x = 1;', "CENSUS_IMPORT_MISSING"],
    ['export async function x(){ return import("node:fs"); }', "CENSUS_DYNAMIC_IMPORT"],
  ]) {
    const root = fixture(source);
    try { errorCode(() => analyzeGuardGraph(root), code); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

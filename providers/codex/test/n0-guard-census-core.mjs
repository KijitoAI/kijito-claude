import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";

export const CENSUS_SCHEMA = "N0_GUARD_CENSUS_V1";
export const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      walk(value, visit, node);
    }
  }
}

function contains(ancestor, descendant) {
  return ancestor.start <= descendant.start && ancestor.end >= descendant.end;
}

function calleeName(callee) {
  if (callee?.type === "Identifier") return callee.name;
  if (callee?.type === "MemberExpression" && !callee.computed
    && callee.object?.type === "Identifier" && callee.property?.type === "Identifier") {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

function literalString(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function atomicTerms(expression) {
  if (!expression) return [];
  if (expression.type === "LogicalExpression") {
    return [...atomicTerms(expression.left), ...atomicTerms(expression.right)];
  }
  return [expression];
}

function sourceFiles(root) {
  const files = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
      else if (entry.isSymbolicLink()) fail("CENSUS_SYMLINK", target);
    }
  }
  visit(root);
  return files;
}

function relativeImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  const options = path.extname(candidate) ? [candidate] : [...SOURCE_EXTENSIONS].map((ext) => `${candidate}${ext}`);
  return options.find((value) => fs.existsSync(value)) ?? candidate;
}

function functionName(node, parent) {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if ((node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression")
    && parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier") return parent.id.name;
  return null;
}

function walkWithinFunction(fn, visit) {
  function descend(node, parent = null) {
    if (!node || typeof node !== "object") return;
    if (node !== fn.node && /Function/.test(node.type)) return;
    if (typeof node.type === "string") visit(node, parent);
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) for (const child of value) descend(child, node);
      else if (value && typeof value === "object" && typeof value.type === "string") descend(value, node);
    }
  }
  descend(fn.node);
}

function enclosingFunction(node, functions) {
  let winner = null;
  for (const fn of functions) {
    if (contains(fn.node, node) && (!winner || fn.node.start > winner.node.start)) winner = fn;
  }
  return winner;
}

function rejectionEscapes(record, node) {
  let current = node;
  while (current) {
    const parent = record.parents.get(current);
    if (!parent) return true;
    if (parent.type === "TryStatement" && parent.handler && contains(parent.block, node)) {
      const last = parent.handler.body?.body?.at(-1);
      if (last?.type !== "ThrowStatement") return false;
    }
    if (/Function/.test(parent.type)) return true;
    current = parent;
  }
  return true;
}

function normalizedNodeSource(record, node) {
  return record.source.slice(node.start, node.end).replace(/\r\n/g, "\n").trim();
}

function stableNode(record, node, kind, extra = {}) {
  const source = normalizedNodeSource(record, node);
  const shortHash = sha256(source).slice(0, 16);
  const line = node.loc.start.line;
  const column = node.loc.start.column + 1;
  return {
    id: `${record.relative}:${line}:${column}:${kind}:${shortHash}`,
    kind,
    file: record.relative,
    line,
    column,
    nodeType: node.type,
    sourceHash: sha256(source),
    source,
    start: node.start,
    end: node.end,
    ...extra,
  };
}

function parseRecord(root, file) {
  const source = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (error) {
    fail("CENSUS_PARSE", `${path.relative(root, file)}:${error.loc?.line ?? "?"}:${error.loc?.column ?? "?"}: ${error.message}`);
  }
  const record = { root, file, relative: path.relative(root, file).split(path.sep).join("/"), source, ast, parents: new Map(), functions: [], imports: new Map(), nodes: [] };
  walk(ast, (node, parent) => {
    if (parent) record.parents.set(node, parent);
    const name = functionName(node, parent);
    if (name) record.functions.push({ key: `${file}#${name}`, name, file, node, record, directReject: false, rejects: false });
    if (node.type === "ImportDeclaration") {
      const importedFile = relativeImport(file, node.source.value);
      if (node.source.value.startsWith(".") && (!importedFile || !path.resolve(importedFile).startsWith(`${path.resolve(root)}${path.sep}`))) {
        fail("CENSUS_IMPORT_ESCAPE", `${record.relative}: ${node.source.value}`);
      }
      if (node.source.value.startsWith(".") && !fs.existsSync(importedFile)) fail("CENSUS_IMPORT_MISSING", `${record.relative}: ${node.source.value}`);
      for (const specifier of node.specifiers) {
        const imported = specifier.type === "ImportSpecifier" ? specifier.imported.name : "default";
        record.imports.set(specifier.local.name, { file: importedFile, name: imported });
      }
    }
    if (node.type === "ImportExpression") fail("CENSUS_DYNAMIC_IMPORT", record.relative);
  });
  return record;
}

function directOutcome(node, parent) {
  if (node.type === "ThrowStatement") return { outcome: "reject", spelling: "throw" };
  if (node.type === "AssignmentExpression" && calleeName(node.left) === "process.exitCode") return { outcome: "terminate", spelling: "process.exitCode" };
  if (node.type === "ObjectExpression" && parent?.type === "ReturnStatement") {
    const statusProperty = node.properties.find((property) => property.type === "Property"
      && !property.computed && ((property.key.type === "Identifier" && property.key.name === "status")
        || literalString(property.key) === "status"));
    const status = literalString(statusProperty?.value);
    if (status === "N0_TEST_CAPABLE") return { outcome: "accept", spelling: "object:N0_TEST_CAPABLE" };
    if (status === "RED" || status === "BLOCKED") return { outcome: "reject", spelling: `object:${status}` };
  }
  if (node.type !== "CallExpression") return null;
  const name = calleeName(node.callee);
  if (name === "process.exit") return { outcome: "terminate", spelling: "process.exit" };
  if (name === "fail") return { outcome: "reject", spelling: "fail" };
  if (name === "verdict") {
    const status = literalString(node.arguments[0]);
    if (status === "N0_TEST_CAPABLE") return { outcome: "accept", spelling: "verdict" };
    if (status === "RED" || status === "BLOCKED") return { outcome: "reject", spelling: `verdict:${status}` };
    return { outcome: "dynamic", spelling: "verdict" };
  }
  return null;
}

function resolveFunction(recordsByFile, functionsByKey, record, localName) {
  const local = functionsByKey.get(`${record.file}#${localName}`);
  if (local) return local;
  const imported = record.imports.get(localName);
  if (!imported?.file) return null;
  const importedRecord = recordsByFile.get(imported.file);
  if (!importedRecord) return null;
  return functionsByKey.get(`${importedRecord.file}#${imported.name}`) ?? null;
}

function nearestRejectingIf(record, sinkNode) {
  let current = record.parents.get(sinkNode);
  while (current) {
    if (current.type === "IfStatement" && contains(current.consequent, sinkNode)) return current;
    if (/Function/.test(current.type)) return null;
    current = record.parents.get(current);
  }
  return null;
}

function callIdentifiers(expression) {
  const names = [];
  walk(expression, (node) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier") names.push(node.callee.name);
  });
  return names;
}

function predicateExpressions(fn) {
  const expressions = [];
  walkWithinFunction(fn, (node) => {
    if (node.type === "ReturnStatement" && node.argument
      && !(node.argument.type === "Literal" && typeof node.argument.value === "boolean")) expressions.push(node.argument);
    if (node.type === "IfStatement") expressions.push(node.test);
  });
  return expressions;
}

function looksBoolean(expression) {
  if (!expression) return false;
  if (expression.type === "Literal") return typeof expression.value === "boolean";
  if (expression.type === "UnaryExpression") return expression.operator === "!";
  if (expression.type === "BinaryExpression") return ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof"].includes(expression.operator);
  if (expression.type === "LogicalExpression") return looksBoolean(expression.left) && looksBoolean(expression.right);
  if (expression.type === "ConditionalExpression") return looksBoolean(expression.consequent) && looksBoolean(expression.alternate);
  if (expression.type === "CallExpression") {
    const name = calleeName(expression.callee);
    const method = expression.callee?.type === "MemberExpression" && !expression.callee.computed
      && expression.callee.property?.type === "Identifier" ? expression.callee.property.name : name?.split(".").at(-1);
    return ["Array.isArray", "Number.isFinite", "Number.isSafeInteger", "path.isAbsolute"].includes(name)
      || ["test", "includes", "startsWith", "endsWith", "some", "every", "isSymbolicLink", "isDirectory", "isFile"].includes(method);
  }
  return false;
}

function functionReturnsBoolean(fn) {
  const returns = [];
  walkWithinFunction(fn, (node) => {
    if (node.type === "ReturnStatement" && node.argument) returns.push(node.argument);
  });
  return returns.length > 0 && returns.every(looksBoolean);
}

export function analyzeGuardGraph(root) {
  const absoluteRoot = path.resolve(root);
  const files = sourceFiles(absoluteRoot);
  const records = files.map((file) => parseRecord(absoluteRoot, file));
  const recordsByFile = new Map(records.map((record) => [record.file, record]));
  const functions = records.flatMap((record) => record.functions);
  const functionsByKey = new Map(functions.map((fn) => [fn.key, fn]));
  const outcomes = [];

  for (const record of records) {
    walk(record.ast, (node) => {
      const outcome = directOutcome(node, record.parents.get(node));
      if (!outcome) return;
      outcomes.push({ record, node, ...outcome });
      const fn = enclosingFunction(node, record.functions);
      if (fn && (outcome.outcome === "reject" || outcome.outcome === "terminate") && rejectionEscapes(record, node)) fn.directReject = true;
    });
  }

  for (const fn of functions) fn.rejects = fn.directReject;
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (fn.rejects) continue;
      walkWithinFunction(fn, (node) => {
        if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return;
        const target = resolveFunction(recordsByFile, functionsByKey, fn.record, node.callee.name);
        if (target?.rejects && rejectionEscapes(fn.record, node)) fn.rejects = true;
      });
      if (fn.rejects) changed = true;
    }
  }

  const discovered = [];
  const predicateQueue = [];
  const queuedPredicates = new Set();
  for (const outcome of outcomes) {
    const kind = outcome.outcome === "accept" ? "success-constructor"
      : outcome.outcome === "terminate" ? "termination-site"
        : outcome.outcome === "dynamic" ? "dynamic-verdict-constructor" : "rejection-site";
    discovered.push(stableNode(outcome.record, outcome.node, kind, { spelling: outcome.spelling }));
    if (outcome.outcome !== "reject" && outcome.outcome !== "terminate") continue;
    const guard = nearestRejectingIf(outcome.record, outcome.node);
    if (!guard) continue;
    for (const atom of atomicTerms(guard.test)) {
      discovered.push(stableNode(outcome.record, atom, "guard-atom", { ownerSinkLine: outcome.node.loc.start.line }));
    }
    for (const name of callIdentifiers(guard.test)) {
      const target = resolveFunction(recordsByFile, functionsByKey, outcome.record, name);
      if (target && functionReturnsBoolean(target) && !queuedPredicates.has(target.key)) {
        queuedPredicates.add(target.key);
        predicateQueue.push(target);
      }
    }
  }

  while (predicateQueue.length) {
    const fn = predicateQueue.shift();
    for (const expression of predicateExpressions(fn)) {
      for (const atom of atomicTerms(expression)) {
        discovered.push(stableNode(fn.record, atom, "predicate-atom", { predicate: fn.name }));
      }
      for (const name of callIdentifiers(expression)) {
        const target = resolveFunction(recordsByFile, functionsByKey, fn.record, name);
        if (target && functionReturnsBoolean(target) && !queuedPredicates.has(target.key)) {
          queuedPredicates.add(target.key);
          predicateQueue.push(target);
        }
      }
    }
  }

  for (const record of records) {
    walk(record.ast, (node) => {
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return;
      const target = resolveFunction(recordsByFile, functionsByKey, record, node.callee.name);
      if (!target?.rejects || node.callee.name === "fail") return;
      discovered.push(stableNode(record, node, "rejecting-helper-call", { helper: target.name }));
      const guard = nearestRejectingIf(record, node);
      const owner = enclosingFunction(node, record.functions);
      if (guard && !guard.alternate && target.key !== owner?.key) {
        for (const atom of atomicTerms(guard.test)) {
          discovered.push(stableNode(record, atom, "guard-atom", { ownerSinkLine: node.loc.start.line }));
        }
      }
    });
  }

  const byId = new Map();
  for (const entry of discovered) {
    if (byId.has(entry.id)) continue;
    byId.set(entry.id, entry);
  }
  const entries = [...byId.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.kind))].sort().map((kind) => [kind, entries.filter((entry) => entry.kind === kind).length]));
  return { schema: CENSUS_SCHEMA, sourceRoot: path.basename(absoluteRoot), files: records.map((record) => record.relative), counts, entries };
}

function identity(entry) {
  const { id, kind, file, line, column, nodeType, sourceHash, source, spelling, ownerSinkLine, predicate, helper } = entry;
  return { id, kind, file, line, column, nodeType, sourceHash, source, spelling, ownerSinkLine, predicate, helper };
}

export function mergeManifest(graph, prior = null) {
  const old = new Map((prior?.entries ?? []).map((entry) => [entry.id, entry]));
  const sinkProjection = graph.entries.filter((entry) => entry.kind === "rejection-site"
    && (entry.spelling === "fail" || entry.spelling === "verdict:RED"));
  return {
    schema: CENSUS_SCHEMA,
    sourceRoot: graph.sourceRoot,
    baseline: {
      commit: "afe5afef156e45523d129525360dfff05a11045c",
      independentSinkSites: 156,
      currentSinkProjection: sinkProjection.length,
      reconciliation: [
        { population: "fail(...) executable call sites", analyzer: sinkProjection.filter((entry) => entry.spelling === "fail").length, independent: 130, discrepancies: [] },
        { population: "verdict(\"RED\", ...) executable call sites", analyzer: sinkProjection.filter((entry) => entry.spelling === "verdict:RED").length, independent: 26, discrepancies: [] },
      ],
      excludedButOwned: ["throw", "verdict:BLOCKED", "process.exit", "process.exitCode", "success-constructor"],
    },
    counts: graph.counts,
    entries: graph.entries.map((entry) => ({
      ...identity(entry),
      mutation: old.get(entry.id)?.mutation ?? null,
      counterexample: old.get(entry.id)?.counterexample ?? null,
    })),
  };
}

export function validateManifest(graph, manifest, { requirePairs = true, requireBaseline = true } = {}) {
  if (manifest?.schema !== CENSUS_SCHEMA) fail("CENSUS_SCHEMA", "manifest schema mismatch");
  const actual = new Map(graph.entries.map((entry) => [entry.id, identity(entry)]));
  const owners = new Map();
  for (const entry of manifest.entries ?? []) {
    if (owners.has(entry.id)) fail("CENSUS_DUPLICATE_OWNER", entry.id);
    owners.set(entry.id, entry);
  }
  for (const [id, entry] of actual) {
    const owner = owners.get(id);
    if (!owner) fail("CENSUS_UNOWNED_NODE", id);
    if (JSON.stringify(identity(owner)) !== JSON.stringify(entry)) fail("CENSUS_STALE_ANCHOR", id);
    if (requirePairs && (!owner.mutation || !owner.counterexample)) fail("CENSUS_PAIR_MISSING", id);
  }
  for (const id of owners.keys()) if (!actual.has(id)) fail("CENSUS_UNMATCHED_OWNER", id);
  if ((graph.counts["success-constructor"] ?? 0) !== 1) fail("CENSUS_SUCCESS_COUNT", String(graph.counts["success-constructor"] ?? 0));
  if (requireBaseline) {
    const projection = graph.entries.filter((entry) => entry.kind === "rejection-site"
      && (entry.spelling === "fail" || entry.spelling === "verdict:RED"));
    if (manifest.baseline?.independentSinkSites !== 156 || manifest.baseline?.currentSinkProjection !== projection.length) {
      fail("CENSUS_BASELINE_RECONCILIATION", `independent=156 current=${projection.length}`);
    }
    const named = manifest.baseline?.reconciliation ?? [];
    if (named.length !== 2 || named.some((item) => item.analyzer !== item.independent || item.discrepancies?.length !== 0)
      || named.reduce((sum, item) => sum + item.analyzer, 0) !== 156) {
      fail("CENSUS_BASELINE_RECONCILIATION", "the independent 156-site projection is not reconciled by name");
    }
  }
  return true;
}

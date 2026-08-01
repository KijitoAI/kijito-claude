import path from "node:path";
import {
  assertExactKeys,
  fail,
  readOwnedRegularFile,
  requireGitCommit,
  requireNonce,
  requireObject,
  requireSafeInteger,
  requireSha256,
  requireString,
  sha256,
  stableJson,
} from "./lib.mjs";
import { validateSpecimen } from "./oracle.mjs";

export function buildEvidenceManifest({ root, specimen, files, createdAt }) {
  validateSpecimen(specimen);
  requireString(root, "MANIFEST_ROOT", "manifest root");
  if (!path.isAbsolute(root)) fail("MANIFEST_ROOT", "manifest root must be absolute");
  if (path.resolve(root) !== path.resolve(specimen.paths.control)) fail("MANIFEST_ROOT", "manifest root must equal the frozen control root");
  if (!Array.isArray(files) || files.length === 0) fail("MANIFEST_FILES", "manifest files must be a non-empty array");
  if (!Number.isFinite(Date.parse(createdAt))) fail("MANIFEST_TIME", "manifest createdAt must be ISO time");
  const unique = new Set();
  const entries = files.map((relative) => {
    requireString(relative, "MANIFEST_PATH", "manifest relative path");
    if (path.isAbsolute(relative)) fail("MANIFEST_PATH", `manifest path must be relative: ${relative}`);
    const normalized = path.normalize(relative);
    if (normalized !== relative || unique.has(relative)) fail("MANIFEST_PATH", `manifest path is duplicate or non-canonical: ${relative}`);
    unique.add(relative);
    const { data, stat } = readOwnedRegularFile(root, path.join(root, relative));
    return { path: relative, bytes: stat.size, sha256: sha256(data) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema: "N0_EVIDENCE_MANIFEST_V1",
    probeId: specimen.probeId,
    protocolDigest: specimen.protocol.digest,
    harnessCommit: specimen.harness.commit,
    harnessDigest: specimen.harness.digest,
    createdAt,
    producer: "N0_OUTSIDE_VERIFIER_V1",
    entries,
  };
}

export function validateEvidenceManifest(specimen, manifest) {
  validateSpecimen(specimen);
  requireObject(manifest, "MANIFEST_SCHEMA", "manifest");
  assertExactKeys(manifest, [
    "schema", "probeId", "protocolDigest", "harnessCommit", "harnessDigest",
    "createdAt", "producer", "entries",
  ], "MANIFEST_SCHEMA", "manifest");
  if (manifest.schema !== "N0_EVIDENCE_MANIFEST_V1") fail("MANIFEST_SCHEMA", "unknown evidence manifest schema");
  requireNonce(manifest.probeId, "MANIFEST_PROVENANCE", "manifest probe id");
  requireSha256(manifest.protocolDigest, "MANIFEST_PROVENANCE", "manifest protocol digest");
  requireGitCommit(manifest.harnessCommit, "MANIFEST_PROVENANCE", "manifest harness commit");
  requireSha256(manifest.harnessDigest, "MANIFEST_PROVENANCE", "manifest harness digest");
  if (manifest.probeId !== specimen.probeId || manifest.protocolDigest !== specimen.protocol.digest
    || manifest.harnessCommit !== specimen.harness.commit || manifest.harnessDigest !== specimen.harness.digest) {
    fail("MANIFEST_PROVENANCE", "manifest provenance differs from specimen");
  }
  if (!Number.isFinite(Date.parse(manifest.createdAt)) || manifest.producer !== "N0_OUTSIDE_VERIFIER_V1") fail("MANIFEST_PROVENANCE", "manifest time/producer is invalid");
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) fail("MANIFEST_ENTRIES", "manifest entries must be non-empty");
  const paths = [];
  for (const [index, rawEntry] of manifest.entries.entries()) {
    let entry = rawEntry;
    requireObject(entry, "MANIFEST_ENTRIES", `manifest entry ${index}`);
    assertExactKeys(entry, ["path", "bytes", "sha256"], "MANIFEST_ENTRIES", `manifest entry ${index}`);
    requireString(entry.path, "MANIFEST_ENTRIES", `manifest entry ${index} path`);
    if (path.isAbsolute(entry.path) || entry.path === ".." || entry.path.startsWith(`..${path.sep}`)) fail("MANIFEST_PATH", "manifest entry path escapes root");
    requireSafeInteger(entry.bytes, "MANIFEST_ENTRIES", `manifest entry ${index} bytes`, { min: 0 });
    requireSha256(entry.sha256, "MANIFEST_ENTRIES", `manifest entry ${index} digest`);
    paths.push(entry.path);
  }
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  if (new Set(paths).size !== paths.length || stableJson(paths) !== stableJson(sorted)) fail("MANIFEST_ORDER", "manifest paths must be unique and sorted");
  return manifest;
}

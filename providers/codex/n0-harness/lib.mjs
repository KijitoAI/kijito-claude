import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS = 50_000;

export class N0Error extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`);
    this.name = "N0Error";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new N0Error(code, message, details);
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireObject(value, code, label) {
  if (!isObject(value)) fail(code, `${label} must be an object`);
  return value;
}

export function requireString(value, code, label, { min = 1, max = 4096 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail(code, `${label} must be a string of length ${min}..${max}`);
  }
  return value;
}

export function requireSafeInteger(value, code, label, { min = 1 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail(code, `${label} must be a safe integer >= ${min}`);
  return value;
}

export function requireSha256(value, code, label) {
  requireString(value, code, label, { min: 64, max: 64 });
  if (!/^[0-9a-f]{64}$/.test(value)) fail(code, `${label} must be lowercase SHA-256 hex`);
  return value;
}

export function requireGitCommit(value, code, label) {
  requireString(value, code, label, { min: 40, max: 64 });
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) fail(code, `${label} must be a full lowercase Git object id`);
  return value;
}

export function requireNonce(value, code, label) {
  requireString(value, code, label, { min: 32, max: 32 });
  if (!/^[0-9a-f]{32}$/.test(value)) fail(code, `${label} must be lowercase 128-bit hex`);
  return value;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertExactKeys(value, allowed, code, label) {
  requireObject(value, code, label);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(code, `${label} contains unsupported keys`, extras.sort());
}

export function pathInside(root, target) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function requirePathInside(root, target, code = "PATH_ESCAPE") {
  if (!pathInside(root, target)) fail(code, `path escapes root: ${target}`);
  return path.resolve(target);
}

export function readOwnedRegularFile(root, target, {
  maxBytes = MAX_JSON_BYTES,
  uid = process.getuid?.(),
} = {}) {
  const rootStat = fs.lstatSync(path.resolve(root));
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail("ROOT_INVALID", "evidence root must be a real directory");
  if (uid !== undefined && rootStat.uid !== uid) fail("OWNER_MISMATCH", "evidence root owner mismatch");
  const absolute = requirePathInside(root, target);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) fail("SYMLINK_REJECTED", `symlink is not evidence: ${absolute}`);
  if (!stat.isFile()) fail("NOT_REGULAR_FILE", `not a regular file: ${absolute}`);
  if (uid !== undefined && stat.uid !== uid) fail("OWNER_MISMATCH", `file owner mismatch: ${absolute}`);
  if (stat.size > maxBytes) fail("FILE_TOO_LARGE", `file exceeds ${maxBytes} bytes: ${absolute}`);
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(absolute);
  requirePathInside(realRoot, realTarget, "REALPATH_ESCAPE");
  const descriptor = fs.openSync(realTarget, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs) {
      fail("CONCURRENT_MUTATION", `file changed before read: ${absolute}`);
    }
    const data = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      fail("CONCURRENT_MUTATION", `file changed during read: ${absolute}`);
    }
    return { data, stat: after, path: realTarget };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function parseJsonBuffer(buffer, code = "INVALID_JSON") {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    fail(code, error.message);
  }
}

export function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

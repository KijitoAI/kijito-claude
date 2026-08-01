import fs from "node:fs";
import path from "node:path";
import {
  MAX_JSON_BYTES,
  fail,
  pathInside,
} from "./lib.mjs";

const DEFAULT_MAX_FILES = 20_000;
const MAX_FIRST_RECORD_BYTES = 64 * 1024;

function firstRecordType(file, expectedStat) {
  const descriptor = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(descriptor);
    if (before.dev !== expectedStat.dev || before.ino !== expectedStat.ino || before.size !== expectedStat.size || before.mtimeMs !== expectedStat.mtimeMs) {
      fail("CONCURRENT_MUTATION", `snapshot file changed before structural read: ${file}`);
    }
    const buffer = Buffer.alloc(MAX_FIRST_RECORD_BYTES);
    const read = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, read).toString("utf8").split("\n", 1)[0];
    let type = null;
    if (line) {
      try {
        const parsed = JSON.parse(line);
        type = typeof parsed?.type === "string" ? parsed.type : null;
      } catch {
        type = null;
      }
    }
    const after = fs.fstatSync(descriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      fail("CONCURRENT_MUTATION", `snapshot file changed during structural read: ${file}`);
    }
    return type;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function snapshotTree(root, {
  maxFiles = DEFAULT_MAX_FILES,
  maxTotalBytes = 512 * 1024 * 1024,
  uid = process.getuid?.(),
} = {}) {
  const absoluteRoot = path.resolve(root);
  const rootStat = fs.lstatSync(absoluteRoot);
  if (!rootStat.isDirectory()) fail("SNAPSHOT_ROOT_INVALID", "snapshot root must be a real directory");
  if (uid !== undefined && rootStat.uid !== uid) fail("SNAPSHOT_OWNER_MISMATCH", "snapshot root owner mismatch");
  const realRoot = fs.realpathSync(absoluteRoot);
  const entries = [];
  let totalBytes = 0;

  const walk = (directory) => {
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, dirent.name);
      const entryStat = fs.lstatSync(target);
      const real = fs.realpathSync(target);
      if (!pathInside(realRoot, real)) fail("REALPATH_ESCAPE", `snapshot entry escapes root: ${target}`);
      if (entryStat.isSymbolicLink() && pathInside(realRoot, real)) fail("SYMLINK_REJECTED", `snapshot contains symlink: ${target}`);
      const stat = fs.lstatSync(real);
      if (uid !== undefined && stat.uid !== uid) fail("SNAPSHOT_OWNER_MISMATCH", `snapshot entry owner mismatch: ${target}`);
      if (stat.isDirectory()) {
        walk(real);
        continue;
      }
      if (!stat.isFile()) fail("NON_REGULAR_ENTRY", `unsupported snapshot entry: ${target}`);
      totalBytes += stat.size;
      if (entries.length + 1 > maxFiles) fail("SNAPSHOT_FILE_LIMIT", `snapshot exceeds ${maxFiles} files`);
      if (totalBytes > maxTotalBytes) fail("SNAPSHOT_BYTE_LIMIT", `snapshot exceeds ${maxTotalBytes} bytes`);
      entries.push({
        path: path.relative(realRoot, real),
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        firstRecordType: stat.size <= MAX_JSON_BYTES ? firstRecordType(real, stat) : null,
      });
    }
  };
  walk(realRoot);
  return { schema: "N0_ROLLOUT_SNAPSHOT_V1", root: realRoot, totalBytes, entries };
}

export function changedCandidates(before, after) {
  if (before?.schema !== "N0_ROLLOUT_SNAPSHOT_V1" || after?.schema !== "N0_ROLLOUT_SNAPSHOT_V1") {
    fail("SNAPSHOT_SCHEMA", "both snapshots must use N0_ROLLOUT_SNAPSHOT_V1");
  }
  if (before.root !== after.root) fail("SNAPSHOT_ROOT_DRIFT", "snapshot roots differ");
  const old = new Map(before.entries.map((entry) => [entry.path, entry]));
  const currentPaths = new Set(after.entries.map((entry) => entry.path));
  for (const prior of before.entries) {
    if (!currentPaths.has(prior.path)) fail("ROLLOUT_REMOVED", `rollout disappeared: ${prior.path}`);
  }
  const changed = [];
  for (const entry of after.entries) {
    const prior = old.get(entry.path);
    if (!prior) {
      changed.push({ ...entry, change: "created", startOffset: 0 });
      continue;
    }
    if (prior.dev !== entry.dev || prior.ino !== entry.ino) {
      fail("ROLLOUT_REPLACED", `rollout identity changed: ${entry.path}`);
    }
    if (entry.size < prior.size) fail("ROLLOUT_TRUNCATED", `rollout shrank: ${entry.path}`);
    if (entry.size > prior.size) changed.push({ ...entry, change: "advanced", startOffset: prior.size });
  }
  return changed.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertSnapshotStable(snapshot, current) {
  try {
    const changed = changedCandidates(snapshot, current);
    if (changed.length) fail("CONCURRENT_MUTATION", "snapshot changed", changed);
  } catch (error) {
    throw error;
  }
  return true;
}

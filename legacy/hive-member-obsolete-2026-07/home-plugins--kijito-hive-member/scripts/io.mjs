import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()
    || stat.isSymbolicLink()
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw Object.assign(new Error("private data directory is unsafe"), {
      code: "private_directory_unsafe",
    });
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on filesystems that do not implement POSIX modes.
  }
}

export function writeTextAtomic(file, payload, mode = 0o600) {
  ensurePrivateDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(temp, "wx", mode);
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Some filesystems do not support syncing directory descriptors.
    }
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Preserve the original write failure.
      }
    }
    try {
      fs.unlinkSync(temp);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        // Preserve the original write failure.
      }
    }
    throw error;
  }
  try {
    fs.chmodSync(file, mode);
  } catch {
    // Best effort on filesystems that do not implement POSIX modes.
  }
}

export function writeJsonAtomic(file, value, mode = 0o600) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function fileStat(file) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      dev: stat.dev,
      ino: stat.ino,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    return { exists: false, error: error.code || "stat_failed" };
  }
}

export function errorCode(error) {
  if (!error) return "unknown_error";
  if (typeof error.code === "string") return error.code;
  const message = String(error.message || error);
  return message.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
}

export function redactForDiagnostics(value) {
  const text = String(value || "");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:token|secret|password)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(-4000);
}

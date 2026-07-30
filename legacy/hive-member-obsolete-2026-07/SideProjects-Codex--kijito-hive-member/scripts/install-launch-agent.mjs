#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensurePrivateDir } from "./io.mjs";

const LABEL = "com.kijito.codex-hive-bridge";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.dirname(scriptDir);

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function commandPath(command, fallback) {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;
  const found = spawnSync("which", [command], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  return fallback;
}

function runLaunchctl(args) {
  return spawnSync("launchctl", args, {
    encoding: "utf8",
    timeout: 10000,
  });
}

function waitSync(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function buildPlist({ nodePath, codexPath, bridgePath, dataDir, tokenFile, stdoutPath, stderrPath }) {
  const args = [nodePath, bridgePath, "--watch"];
  const argXml = args.map((arg) => `      <string>${xml(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>KIJITO_PERSONA</key>
    <string>codex</string>
    <key>KIJITO_PROJECT</key>
    <string>Codex</string>
    <key>KIJITO_CODEX_COMMAND</key>
    <string>${xml(codexPath)}</string>
    <key>KIJITO_CODEX_DATA_DIR</key>
    <string>${xml(dataDir)}</string>
    <key>KIJITO_TOKEN_FILE</key>
    <string>${xml(tokenFile)}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
}

function install() {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    throw new Error("LaunchAgent installation is supported only on macOS");
  }
  const home = os.homedir();
  const launchDir = path.join(home, "Library", "LaunchAgents");
  const plistPath = path.join(launchDir, `${LABEL}.plist`);
  const dataDir = process.env.KIJITO_CODEX_DATA_DIR || path.join(
    home,
    ".cache",
    "kijito-codex-bridge",
  );
  const tokenFile = process.env.KIJITO_TOKEN_FILE || path.join(
    home,
    ".config",
    "kijito-inbox-monitor",
    "token",
  );
  const nodePath = commandPath(process.execPath, "/usr/bin/node");
  const codexPath = commandPath(
    process.env.KIJITO_CODEX_COMMAND || "codex",
    "/opt/homebrew/bin/codex",
  );
  const bridgePath = path.join(pluginRoot, "scripts", "bridge.mjs");
  const stdoutPath = path.join(dataDir, "bridge.out");
  const stderrPath = path.join(dataDir, "bridge.err");
  if (!fs.existsSync(bridgePath)) throw new Error(`bridge script missing: ${bridgePath}`);

  fs.mkdirSync(launchDir, { recursive: true });
  ensurePrivateDir(dataDir);
  const domain = `gui/${process.getuid()}`;
  runLaunchctl(["bootout", `${domain}/${LABEL}`]);

  if (fs.existsSync(plistPath)) {
    fs.renameSync(plistPath, `${plistPath}.previous.${Date.now()}`);
  }
  const temp = `${plistPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, buildPlist({
    nodePath,
    codexPath,
    bridgePath,
    dataDir,
    tokenFile,
    stdoutPath,
    stderrPath,
  }), { mode: 0o644 });
  fs.renameSync(temp, plistPath);
  fs.chmodSync(plistPath, 0o644);

  let bootstrap = runLaunchctl(["bootstrap", domain, plistPath]);
  for (const delay of [200, 400, 800, 1600]) {
    if (bootstrap.status === 0) break;
    waitSync(delay);
    bootstrap = runLaunchctl(["bootstrap", domain, plistPath]);
  }
  if (bootstrap.status !== 0) {
    throw new Error(`launchctl bootstrap failed: ${bootstrap.stderr.trim()}`);
  }
  const kickstart = runLaunchctl(["kickstart", "-k", `${domain}/${LABEL}`]);
  const service = runLaunchctl(["print", `${domain}/${LABEL}`]);
  if (kickstart.status !== 0 && service.status !== 0) {
    throw new Error(
      `launchctl could not start or verify ${LABEL}: ${
        kickstart.stderr.trim() || service.stderr.trim() || "unknown launchctl error"
      }`,
    );
  }
  return {
    installed: true,
    label: LABEL,
    plistPath,
    pluginRoot,
    dataDir,
    bridgePath,
    codexPath,
    nodePath,
  };
}

function uninstall() {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    throw new Error("LaunchAgent installation is supported only on macOS");
  }
  const plistPath = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LABEL}.plist`,
  );
  const domain = `gui/${process.getuid()}`;
  runLaunchctl(["bootout", `${domain}/${LABEL}`]);
  let preservedPath = null;
  if (fs.existsSync(plistPath)) {
    preservedPath = `${plistPath}.disabled.${Date.now()}`;
    fs.renameSync(plistPath, preservedPath);
  }
  return {
    installed: false,
    label: LABEL,
    plistPath,
    preservedPath,
  };
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv.includes("--uninstall") ? uninstall() : install();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export { buildPlist, install, uninstall };

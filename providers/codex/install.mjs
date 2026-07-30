#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This installer used to live at <root>/release/install.mjs, so its source root was one level up.
// Folded into kijito-claude it sits AT the provider root (providers/codex/), so `here` IS the source
// root. The shared wake core is a sibling of that root, at providers/_shared/wake-core.mjs.
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRootDefault = here;

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArgs(argv) {
  const values = {};
  // Boolean flags first: the loop below consumes strict `--key value` pairs and would reject a bare
  // flag as an invalid argument.
  const flags = new Set(["skills-only"]);
  const bare = new Set();
  argv = argv.filter((token) => {
    const isFlag = token.startsWith("--") && flags.has(token.slice(2));
    if (isFlag) bare.add(token.slice(2));
    return !isFlag;
  });
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${key ?? ""}`);
    values[key.slice(2)] = argv[index + 1];
  }
  const home = os.homedir();
  const expand = (value) => path.resolve(value.replace(/^~(?=\/|$)/, home));
  return {
    sourceRoot: expand(values["source-root"] ?? sourceRootDefault),
    installRoot: expand(values["install-root"] ?? path.join(home, ".local", "share", "codex-kijito-hive")),
    launcher: expand(values.launcher ?? path.join(home, ".local", "bin", "codex-kijito-hive")),
    authSource: expand(values["auth-source"] ?? path.join(home, ".codex", "auth.json")),
    ordinaryConfig: expand(values["ordinary-config"] ?? path.join(home, ".codex", "config.toml")),
    tokenFile: expand(values["token-file"] ?? path.join(home, ".claude", ".kijito_api_token")),
    eventsFile: expand(values["events-file"] ?? path.join(home, ".cache", "kijito-inbox-monitor", "events.codex.ndjson")),
    codexBin: expand(values["codex-bin"] ?? path.join(home, ".local", "bin", "codex")),
    nodeBin: expand(values["node-bin"] ?? process.execPath),
    skillsRoot: expand(values["skills-root"] ?? path.join(home, ".codex", "skills")),
    skillsOnly: bare.has("skills-only"),
  };
}

// Deploy the provider's skills to the Codex skills directory.
//
// SEPARATE FROM THE INSTALL ROOT, AND IDEMPOTENT, on purpose. The install root is created once and
// atomically, and refuses to overwrite — correct for a supervised runtime holding a copied auth
// token. Skills are the opposite kind of thing: versioned prose that is meant to be UPDATED in
// place, so they are written over.
//
// This exists because the fold found codex's two skills living ONLY at ~/.codex/skills with no
// upstream in any repository. Version-controlling them without also shipping a way to deploy them
// would have left the rescue half-done: the next machine would have the repo and still no skills.
function installSkills({ sourceRoot, skillsRoot }) {
  const source = path.join(sourceRoot, "skills");
  const deployed = [];
  let names = [];
  try { names = fs.readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
  catch (error) { if (error.code === "ENOENT") return deployed; throw error; }
  for (const name of names) {
    const skillFile = path.join(source, name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const target = path.join(skillsRoot, name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), fs.readFileSync(skillFile), { mode: 0o644 });
    const files = ["SKILL.md"];
    // The agents/ sidecar carries the Codex-surface interface metadata (display name, default
    // prompt). A skill deployed without it loses its presentation, so it travels with the skill.
    const sidecar = path.join(source, name, "agents", "openai.yaml");
    if (fs.existsSync(sidecar)) {
      fs.mkdirSync(path.join(target, "agents"), { recursive: true });
      fs.writeFileSync(path.join(target, "agents", "openai.yaml"), fs.readFileSync(sidecar), { mode: 0o644 });
      files.push("agents/openai.yaml");
    }
    deployed.push({ skill: name, target, files });
  }
  return deployed;
}

function requireAbsoluteDistinct(options) {
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string" && !path.isAbsolute(value)) throw new Error(`${key} must be absolute`);
  }
  if (options.installRoot === path.parse(options.installRoot).root) throw new Error("install root cannot be a filesystem root");
  if (options.launcher === options.installRoot || options.launcher.startsWith(`${options.installRoot}${path.sep}`)) {
    throw new Error("launcher must be outside the install root");
  }
}

function requirePrivateRegular(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`${label} must be one regular file`);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be private and user-owned`);
}

function requireExecutable(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) throw new Error(`${label} must be an executable regular file`);
}

function optionalHash(file) {
  try { return sha256(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function writePrivate(file, content, mode = 0o600) {
  fs.writeFileSync(file, content, { flag: "wx", mode });
  fs.chmodSync(file, mode);
}

function configText() {
  return [
    'approval_policy = "never"',
    'default_permissions = "hive-read"',
    'web_search = "disabled"',
    '',
    '[features]',
    'apps = false',
    'goals = false',
    'hooks = false',
    'multi_agent = false',
    'remote_plugin = false',
    'shell_snapshot = false',
    'shell_tool = false',
    'unified_exec = false',
    '',
    '[permissions.hive-read.filesystem]',
    '":root" = "deny"',
    '":minimal" = "read"',
    '',
    '[permissions.hive-read.filesystem.":workspace_roots"]',
    '"." = "read"',
    '',
    '[permissions.hive-read.network]',
    'enabled = false',
    '',
    '[mcp_servers.kijito]',
    'url = "https://api.kijito.ai/mcp/"',
    'bearer_token_env_var = "KIJITO_API_TOKEN"',
    'enabled = true',
    'required = true',
    'enabled_tools = ["kijito_hive_inbox"]',
    'default_tools_approval_mode = "approve"',
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 60',
    '',
  ].join("\n");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function launcherText({ installRoot, nodeBin }) {
  return [
    "#!/bin/sh",
    "set -eu",
    'if [ -n "${CODEX_KIJITO_NODE:-}" ] && [ -x "${CODEX_KIJITO_NODE}" ]; then',
    '  kijito_node="${CODEX_KIJITO_NODE}"',
    `elif [ -x ${shellQuote(nodeBin)} ]; then`,
    `  kijito_node=${shellQuote(nodeBin)}`,
    'elif command -v node >/dev/null 2>&1 && node -e \'process.exit(Number(process.versions.node.split(".")[0]) < 20)\'; then',
    '  kijito_node="$(command -v node)"',
    "else",
    '  echo "codex-kijito-hive: Node.js 20+ is required; set CODEX_KIJITO_NODE to a healthy executable" >&2',
    "  exit 1",
    "fi",
    `exec "$kijito_node" ${shellQuote(path.join(installRoot, "cli.mjs"))} "$@"`,
    "",
  ].join("\n");
}

function copyPrivate(source, target, mode = 0o600) {
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, mode);
}

function install(options) {
  requireAbsoluteDistinct(options);
  const sourceManifestFile = path.join(options.sourceRoot, "release-manifest.json");
  const controllerSource = path.join(options.sourceRoot, "controller.mjs");
  const cliSource = path.join(options.sourceRoot, "cli.mjs");
  const controllerTests = path.join(options.sourceRoot, "test", "codex-hive-watch.test.mjs");
  const wakeCoreSource = path.join(options.sourceRoot, "..", "_shared", "wake-core.mjs");
  const release = JSON.parse(fs.readFileSync(sourceManifestFile, "utf8"));
  if (release.schema !== 1 || release.product !== "codex-kijito-hive") throw new Error("invalid source release manifest");
  if (sha256(controllerSource) !== release.artifacts.controllerSha256) throw new Error("controller differs from gated hash");
  if (sha256(controllerTests) !== release.artifacts.controllerTestsSha256) throw new Error("controller tests differ from gated hash");
  // The wake core is executable code inside a hash-gated install, so it is gated exactly like the
  // controller it was extracted from. Splitting a gated file into gated + ungated halves would have
  // left parseEventLine and fixedWakeText -- the event validator and the injection fence -- editable
  // while the integrity hashes still passed.
  if (sha256(wakeCoreSource) !== release.artifacts.wakeCoreSha256) throw new Error("wake core differs from gated hash");
  // The parity plan is RECORDED, not gated. It used to be hash-gated here, from a path OUTSIDE the
  // installable directory (`<sourceRoot>/../codex-kijito-parity-plan.md`), which meant every install
  // threw the moment the source root moved -- and gated an install on a prose document. The hash is
  // still carried forward into the installed manifest below for provenance.
  requirePrivateRegular(options.authSource, "auth source");
  requirePrivateRegular(options.tokenFile, "token file");
  options.codexBin = fs.realpathSync(options.codexBin);
  options.nodeBin = fs.realpathSync(options.nodeBin);
  requireExecutable(options.codexBin, "Codex binary");
  requireExecutable(options.nodeBin, "Node binary");
  const ordinaryBefore = {
    configSha256: optionalHash(options.ordinaryConfig),
    authSha256: sha256(options.authSource),
  };
  for (const target of [options.installRoot, options.launcher]) {
    try { fs.lstatSync(target); throw new Error(`refusing to overwrite existing target: ${target}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  fs.mkdirSync(path.dirname(options.installRoot), { recursive: true });
  fs.mkdirSync(path.dirname(options.launcher), { recursive: true });
  options.installRoot = path.join(fs.realpathSync(path.dirname(options.installRoot)), path.basename(options.installRoot));
  options.launcher = path.join(fs.realpathSync(path.dirname(options.launcher)), path.basename(options.launcher));
  const tempRoot = fs.mkdtempSync(path.join(path.dirname(options.installRoot), `.codex-kijito-hive.install.${randomBytes(4).toString("hex")}.`));
  fs.chmodSync(tempRoot, 0o700);
  let committed = false;
  try {
    // The installed layout MIRRORS the repo's relative layout for the two code files, so the
    // controller's `import "../_shared/wake-core.mjs"` specifier is identical in both trees -- no
    // rewriting at install time, no duplicated copy of the shared module, no symlink.
    for (const name of ["codex-home", "workspace", "runtime", "codex", "_shared"]) fs.mkdirSync(path.join(tempRoot, name), { mode: 0o700 });
    copyPrivate(options.authSource, path.join(tempRoot, "codex-home", "auth.json"));
    writePrivate(path.join(tempRoot, "codex-home", "config.toml"), configText());
    copyPrivate(controllerSource, path.join(tempRoot, "codex", "controller.mjs"));
    copyPrivate(wakeCoreSource, path.join(tempRoot, "_shared", "wake-core.mjs"));
    copyPrivate(cliSource, path.join(tempRoot, "cli.mjs"));
    const installed = {
      schema: 1,
      product: release.product,
      version: release.version,
      installId: randomBytes(16).toString("hex"),
      installedAt: new Date().toISOString(),
      paths: {
        installRoot: options.installRoot,
        launcher: options.launcher,
        codexHome: path.join(options.installRoot, "codex-home"),
        workspace: path.join(options.installRoot, "workspace"),
        runtime: path.join(options.installRoot, "runtime"),
        tokenFile: options.tokenFile,
        eventsFile: options.eventsFile,
        codexBin: options.codexBin,
        nodeBin: options.nodeBin,
        ordinaryConfig: options.ordinaryConfig,
        ordinaryAuth: options.authSource
      },
      hashes: {
        controllerSha256: sha256(path.join(tempRoot, "codex", "controller.mjs")),
        wakeCoreSha256: sha256(path.join(tempRoot, "_shared", "wake-core.mjs")),
        cliSha256: sha256(path.join(tempRoot, "cli.mjs")),
        configSha256: sha256(path.join(tempRoot, "codex-home", "config.toml")),
        authSha256: sha256(path.join(tempRoot, "codex-home", "auth.json")),
        planSha256: release.artifacts.planSha256,
        controllerTestsSha256: release.artifacts.controllerTestsSha256,
        ordinaryConfigBeforeSha256: ordinaryBefore.configSha256,
        ordinaryAuthBeforeSha256: ordinaryBefore.authSha256
      },
      invariants: {
        hooks: false,
        launchAgent: false,
        ordinaryCodexStateMutation: false,
        currentUserThreadMutation: false,
        messageBodyInjection: false
      }
    };
    writePrivate(path.join(tempRoot, "installed-manifest.json"), `${JSON.stringify(installed, null, 2)}\n`);
    fs.renameSync(tempRoot, options.installRoot);
    const launcher = launcherText(options);
    writePrivate(options.launcher, launcher, 0o700);
    installed.hashes.launcherSha256 = sha256(options.launcher);
    fs.writeFileSync(path.join(options.installRoot, "installed-manifest.json"), `${JSON.stringify(installed, null, 2)}\n`, { mode: 0o600 });
    committed = true;
    const ordinaryAfter = {
      configSha256: optionalHash(options.ordinaryConfig),
      authSha256: sha256(options.authSource),
    };
    if (JSON.stringify(ordinaryAfter) !== JSON.stringify(ordinaryBefore)) throw new Error("ordinary Codex state changed during installation");
    const skills = installSkills(options);
    return { status: "INSTALLED", installRoot: options.installRoot, launcher: options.launcher, ordinaryStateUnchanged: true, hashes: installed.hashes, skills };
  } finally {
    if (!committed) {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  // --skills-only updates the skills on a machine whose install root already exists, which a full
  // install deliberately refuses to touch.
  const result = options.skillsOnly
    ? { status: "SKILLS_INSTALLED", skillsRoot: options.skillsRoot, skills: installSkills(options) }
    : install(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

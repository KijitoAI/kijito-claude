#!/usr/bin/env node
'use strict';
// kijito-claude — thin launcher that runs the bundled bash installer (install.sh).
// The package ships the scripts/skills as data; this resolves them relative to the
// package root (never process.cwd()) and shells out to bash. Run with: npx kijito-claude
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pkgRoot = path.resolve(__dirname, '..');
const installScript = path.join(pkgRoot, 'install.sh');

// install.sh is POSIX bash. Native Windows has no bash; point users at WSL/Git Bash
// rather than letting them hit a cryptic ENOENT.
const probe = spawnSync('bash', ['--version'], { stdio: 'ignore' });
if (probe.error) {
  console.error(
    'kijito-claude needs bash to run its installer.\n' +
    (process.platform === 'win32'
      ? 'On Windows, run it inside WSL (recommended) or Git Bash.\n'
      : 'Install bash and try again.\n') +
    'See https://github.com/KijitoAI/kijito-claude#platform-support'
  );
  process.exit(1);
}

const result = spawnSync('bash', [installScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) {
  console.error('Failed to launch the installer:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

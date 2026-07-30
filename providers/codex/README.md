# Codex provider — Kijito hive wake consumer

The `codex` provider of [kijito-claude](../../README.md). QA-gated implementation of the four-gate
release in [`codex-kijito-parity-plan.md`](codex-kijito-parity-plan.md) — a document RECORDED here
for provenance, not gated on: hash-gating an install against a prose file outside the installable
directory was a real defect, fixed in the 2026-07-30 fold.

This provider consumes the shipped Kijito monitor's per-persona event stream and wakes one dedicated
Codex app-server thread. It does not install hooks, plugins, LaunchAgents, model catalogs, or changes
to the ordinary Codex home.

Production is an explicit, isolated install: one private root and one launcher. Nothing starts at
login. A fresh install refuses to overwrite an existing target; upgrades use the separate,
state-preserving `--upgrade` transaction below.

## Layout

The wake PROTOCOL is not Codex-specific and lives one level up in
[`../_shared/wake-core.mjs`](../_shared/wake-core.mjs): event-line validation, the injection-fenced
wake text, read-offset persistence, and the single-consumer lock. `controller.mjs` holds what is
genuinely about Codex — supervising a `codex app-server` on a dedicated `CODEX_HOME`, owning one
thread, delivering the wake turn — and binds the persona the shared core refuses to default.

Both files are hash-gated at install and hash-checked by `doctor`. That is deliberate rather than
incidental: splitting one gated file into a gated half and an ungated half would have left the event
validator and the injection fence editable while the integrity hashes still passed.

The installed layout mirrors this one, so the controller's import specifier is identical in both:

    <installRoot>/cli.mjs
    <installRoot>/codex/controller.mjs
    <installRoot>/_shared/wake-core.mjs

## Test

```sh
node --test test/codex-hive-watch.test.mjs test/release-packaging.test.mjs
node tools/refresh-manifest.mjs --check    # gated hashes still describe the files
```

Do not pass `test/` as a directory: the runner would treat the `mock-app-server.mjs` and
`prepare-live-gate.mjs` helpers as suites. After editing `controller.mjs`, `../_shared/wake-core.mjs`,
or `test/codex-hive-watch.test.mjs`, run `node tools/refresh-manifest.mjs` — otherwise the next
install fails with a hash mismatch that reads like corruption rather than a stale manifest.

## Required dedicated home

The live gate creates a private temporary `CODEX_HOME` containing:

- a private `auth.json` copy;
- a minimal config selecting the `hive-read` permission profile;
- only the hosted `kijito` MCP server, with only `kijito_hive_inbox` enabled;
- an empty, read-only workspace.

The bearer token is passed through `KIJITO_API_TOKEN`; it is never placed on a
command line or in controller state.

## Install and operate

The release manifest owns only `~/.local/share/codex-kijito-hive` and
`~/.local/bin/codex-kijito-hive`. Run the installer with a healthy Node 20+
runtime, then use the explicit launcher:

```sh
node install.mjs                 # or, from the repo root: ./install.sh --provider codex
codex-kijito-hive doctor
codex-kijito-hive smoke
codex-kijito-hive start
codex-kijito-hive status
codex-kijito-hive stop
```

`start` is an explicit detached start, not a login item or `LaunchAgent`.
`smoke` starts, waits for the dedicated thread to arm, and stops cleanly.
`doctor` reports `ARMED`, `INACTIVE`, or `RED`; only `ARMED` means the wake path is live.

Upgrade an existing install with the installer, never with uninstall/reinstall:

```sh
node install.mjs --upgrade
```

The upgrade stages and verifies new bytes, stops the sole old consumer, preserves its thread,
mail high-water mark, event cursor, and log, swaps roots, and re-arms before returning. The
consumer lock is stream-scoped rather than install-root-scoped, so a second root cannot double-arm
the same persona. Mail written during the bounded swap remains after the inherited cursor and is
consumed on the new run. A failed new start restores and re-arms the previous installation; a
private rollback root is retained after success and reported in the command result.

The shared monitor directory that owns the global lock may be `0755`, matching the monitor's
production layout. It must be a real directory owned by the current uid and may not be writable by
group or other users (`0775`/`0777` are rejected). The event stream and lock files themselves remain
private `0600`; the dedicated Codex home, workspace, runtime, and install directories remain `0700`.

Uninstall is manifest-bound and confirm-required:

```sh
codex-kijito-hive uninstall --confirm-dedicated-home
```

Uninstall removes only the dedicated root and launcher. It never edits the
ordinary Codex home.

## Skills

The two skills in [`skills/`](skills/) deploy to `~/.codex/skills`, each with its `agents/openai.yaml`
interface sidecar:

```sh
node install.mjs --skills-only                       # update skills on an existing install
node install.mjs --skills-only --skills-root <dir>    # or somewhere else
```

A full install deploys them too. Unlike the install root, skills are written OVER — they are
versioned prose meant to be updated. This path exists because both skills were, until the fold,
present only at `~/.codex/skills` with no upstream in any repository: version-controlling them
without a way to deploy them would have left the rescue half-done.

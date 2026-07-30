# Codex provider — withdrawn dedicated-thread notifier

> **Do not install, upgrade, migrate, or describe this provider as same-chat continuation.** Live
> message 2630 proved that it can notify a dedicated app-server thread while leaving the user's
> working chat idle. PR #5 is closed as withdrawn. The replacement is still plan-only and gated in
> [`same-chat-continuation-plan.md`](same-chat-continuation-plan.md); it authorizes no implementation
> or production change.

The `codex` provider of [kijito-claude](../../README.md). QA-gated implementation of the four-gate
release in [`codex-kijito-parity-plan.md`](codex-kijito-parity-plan.md) — a document RECORDED here
for provenance, not gated on: hash-gating an install against a prose file outside the installable
directory was a real defect, fixed in the 2026-07-30 fold.

This provider consumes the shipped Kijito monitor's per-persona event stream and wakes one dedicated
Codex app-server thread. It does not install hooks, plugins, LaunchAgents, model catalogs, or changes
to the ordinary Codex home.

The remaining sections describe the withdrawn research artifact for provenance and review only.
Production previously used an explicit, isolated install: one private root and one launcher. Nothing
starts at login, and the installer refuses to overwrite an existing target.

## Layout

The wake PROTOCOL is not Codex-specific and lives one level up in
[`../_shared/wake-core.mjs`](../_shared/wake-core.mjs): event-line validation, the injection-fenced
wake text, read-offset persistence, and the single-consumer lock. `controller.mjs` holds what is
genuinely about Codex — supervising a `codex app-server` on a dedicated `CODEX_HOME`, owning one
thread, delivering the wake turn — and binds the persona the shared core refuses to default.

Both files are hash-gated at install and hash-checked by `doctor`. That is deliberate rather than
incidental: splitting one gated file into a gated half and an ungated half would have left the event
validator and the injection fence editable with `doctor` still reporting GREEN.

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

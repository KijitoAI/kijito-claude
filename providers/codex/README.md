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

The release manifest owns the dedicated `~/.local/share/codex-kijito-hive` tree and
`~/.local/bin/codex-kijito-hive` launcher, and records the external deterministic lock path under
the monitor event directory. Run the installer with a healthy Node 20+ runtime, then use the
explicit launcher:

The Kijito inbox monitor must be installed and running first: its private
`~/.cache/kijito-inbox-monitor/events.codex.ndjson` event file must already exist before either a
fresh install or `--upgrade`. The installer deliberately validates that real producer-owned file;
it does not create a look-alike stream on the consumer's behalf.

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
consumer lock is derived from the event-stream directory plus persona rather than the install root,
so a second root consuming that same persona stream cannot double-arm it. Mail written during the
bounded swap remains after the inherited cursor and is consumed on the new run. A failed new start
restores and re-arms the previous installation; a private rollback root is retained after success
and reported in the command result.

Upgrade refuses silent changes to the installed ordinary-auth source, ordinary config, token file,
or Node runtime. If a non-default path was used for the original installation, pass the same path
flags again. The configured Codex executable is the deliberate exception: upgrading from a legacy
version-pinned release path to the stable Codex symlink is supported and reported by `doctor`.

At most the two newest private `.rollback.*` roots and the two newest `.failed.*` roots are retained
after a successful upgrade; older safe, user-owned `0700` historical roots are pruned. These roots
contain a private copy of the dedicated Codex home, including `auth.json`, so they are recovery
artifacts rather than ordinary build output. A failed upgrade never prunes its own recovery bytes.

The shared monitor directory may be `0755`, matching the monitor's production layout. It must be a
real directory owned by the current uid and may not be writable by group or other users
(`0775`/`0777` are rejected). The event stream remains private `0600`. Consumer and upgrade locks,
including temporary quarantine names, live under the package-owned
`<eventsDir>/.codex-hive-locks/` directory: that directory is strict `0700` and each lock is `0600`.
The dedicated Codex home, workspace, runtime, and install directories also remain `0700`. Direct
controller invocations and the live-gate helper derive the same event-directory/persona lock; a
caller cannot substitute a per-runtime lock while consuming the selected stream. The installer and
controller accept an explicit lock option only when it resolves to that exact deterministic path,
and `doctor` rejects a manifest that diverges.

The pre-canonical flat controller used a different runtime-local lock. Therefore its live ownership
cannot exclude a new-version controller mechanically. Never run `test/prepare-live-gate.mjs`, a
direct new controller, or a second new-code installation against the real stream while the legacy
`runtime/consumer.lock` exists. The live-gate helper refuses that condition. The supported cutover
is the single `--upgrade` transaction, which stops the legacy owner before arming canonical bytes.

The installed manifest preserves the configured Codex executable path instead of resolving it to a
versioned release directory. This intentionally follows a stable vendor symlink across a normal
Codex upgrade and avoids pinning a release directory that the vendor may prune. `doctor` resolves
and validates the current executable target on every run; `codexTargetChanged` reports a retarget
as information, while a missing or non-executable target is `RED`.

`doctor` also compares the ordinary Codex `auth.json` and `config.toml` with their install-time
snapshots. Codex may legitimately rewrite those files, in which case the controller fails closed
with ordinary-state drift. After reviewing the change, refresh the supervised snapshot with
`./install.sh --provider codex --upgrade`; do not edit `installed-manifest.json` by hand.

The dedicated workspace must remain completely empty; even metadata such as `.DS_Store` makes
`doctor` and `start` fail closed. Remove unexpected workspace entries before retrying.

On a first install, the controller begins at the current end of the monitor event file, then issues
a durable-inbox reconciliation so unread mail is discovered without replaying old event rows.
Queued metadata is persisted while it is waiting for a delivery attempt. Once an attempt begins,
its metadata moves to `lastAttempt`: an uncertain in-flight mail batch is never replayed directly;
startup/recovery reconciles the durable inbox instead.

If process inspection is denied but a fresh private heartbeat proves ownership, status can still
identify the controller as running but `stop` deliberately refuses to signal it. Re-run `status`,
`doctor`, or `stop` outside the restricted sandbox so the full process command can be verified;
never remove or signal a heartbeat-only lock by force.

Uninstall is manifest-bound and confirm-required:

```sh
codex-kijito-hive uninstall --confirm-dedicated-home
```

Uninstall removes only the dedicated root and launcher. It never edits the ordinary Codex home or
another installation's shared lock namespace. The empty `.codex-hive-locks` directory may remain
because another stopped installation or future persona can use that same event-directory namespace.

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

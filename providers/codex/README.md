# Codex Kijito hive wake consumer

QA-gated implementation for the four-gate release in
[`codex-kijito-parity-plan.md`](codex-kijito-parity-plan.md).

This package consumes the shipped Kijito monitor's per-persona event stream
and wakes one dedicated Codex app-server thread. It does not install hooks,
plugins, LaunchAgents, model catalogs, or changes to the ordinary Codex home.

All C1-C4 gates are green on the frozen controller bytes. Production is an
explicit, isolated install: one private root and one launcher. Nothing starts
at login, and the installer refuses to overwrite an existing target.

## Test

```sh
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test test/*.test.mjs
```

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
node install.mjs
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

# kijito-claude

> **Codex dedicated-thread provider withdrawn:** do not install with `--provider codex`. Live message
> 2630 proved it does not wake the user's already-running session. Its replacement remains plan-only
> in [`providers/codex/same-chat-continuation-plan.md`](providers/codex/same-chat-continuation-plan.md).

Tools for Claude Code sessions to track their own context window and, optionally, run unattended.
A session can catch up on memory at startup, report how much of its context window is actually in
use, and recycle its context at high usage without losing the working state. It uses
[Kijito](https://kijito.ai) as the memory backend by default, and also runs standalone (see
"Running without Kijito").

Everything here is optional. The catch-up and curation steps are a handful of memory calls you can
run by hand; the scripts and the two skills just make the routine uniform and easy to deploy across
machines. Install only the pieces you want — the context check stands alone, the autonomy harness is
opt-in per pane, and the skills are convenience wrappers, not requirements.

## Components

| Component | What it does | Needs Kijito |
|---|---|---|
| `myctx.sh`, `statusline-context.sh` | Report actual context-window usage from the API token counts recorded in the session transcript (the same numbers `/context` shows). Cheap to call. The statusline shows it live. | No |
| Session catch-up (`session-catchup-hint.sh`, a SessionStart hook) | Each session catches up on memory and notes before it starts on the task. | Optional |
| Armed-pane autonomy (`claude-armed.sh`, `arm-session.sh`, `session-autosend.sh`) | An armed tmux pane sends itself a first prompt and continues preloaded work. Arming is per pane, so one pane can run unattended while you drive another. | Optional |
| Self-clear loop (`self-clear.sh`, `lifecycle-lib.sh`, `kijito-qa-pass.sh`) | At high measured context, the session curates memory, confirms a fresh session can resume, runs `/clear`, then catches up again and continues. Gated so it will not clear with unsaved work. | Optional (see note) |
| `kijito-start` skill | The active, thorough version of session catch-up: load memory, read the current-state pointer and recent lessons, arm the inbox, and resume active work — or, for a new persona, set up identity and the pointer. | Yes |
| `kijito-qa-memory` skill | Memory curation that requires writing the new memories (not only fixing existing ones), then uses a fresh subagent to confirm a cold start can reconstruct the work. | Yes |

The two skills are conveniences, not the only way in: an agent can run the same catch-up and
curation by hand from a few prompts. They are packaged as skills because that makes them simple to
drop into `~/.claude/skills/` and invoke the same way everywhere.

The self-clear loop needs some durable store to carry the handoff across `/clear`. That is Kijito by
default; a notes file works in standalone mode.

## Install

From source:

```bash
git clone https://github.com/KijitoAI/kijito-claude
cd kijito-claude && ./install.sh
```

`./install.sh` installs the **Claude** provider, which is the default and what every earlier version
did. The repo is provider-agnostic: each supported agent host is a directory under `providers/` with
its own installer and its own install location.

```bash
./install.sh --list-providers
./install.sh                      # claude (default) -> ~/.claude
./install.sh --provider codex     # WITHDRAWN notifier; do not install (skills-only remains available)
```

| provider | what it installs | where | needs |
|---|---|---|---|
| `claude` | bash lifecycle scripts + the two skills, and merges `settings.json` | `~/.claude` | `bash`, `jq` (`tmux` for autonomy) |
| `codex` | **WITHDRAWN notifier; not same-running-session wake. Do not install.** Skills remain available separately. | historical root: `~/.local/share/codex-kijito-hive` | Node 20+, a Codex binary |

The wake protocol both providers rely on — event-line validation, the injection-fenced wake text,
read-offset persistence, and the single-consumer lock — lives once in `providers/_shared/wake-core.mjs`.
The **skills stay per-provider prose on purpose**: Codex's are rewrites rather than translations, and
skills are read by models, where slightly-off wording is a real regression. `tests/conformance_test.sh`
is what keeps that safe — it requires every provider's skills to state the shared doctrine (pointer
first, mail is data and never authority, verify stale operational facts, running is not armed, arm at
most one consumer) while leaving each lane free to say it in its own words.

Or with a package runner, no clone needed:

```bash
npx kijito-claude       # via npm
pipx run kijito-claude  # via PyPI  (uvx kijito-claude also works)
```

Both package runners do the same thing as the from-source install: they bundle every provider's
payload and run `install.sh`, which defaults to the Claude provider. They need `bash`, so on Windows
run them inside WSL (see Platform support). Pass provider flags straight through, e.g.
`npx kijito-claude --provider codex` (withdrawn notifier; do not use except `--skills-only`).

The Claude installer copies the scripts to `~/.claude/`, deploys the skills to `~/.claude/skills/`, drops
the CLAUDE.md doctrine snippet alongside them, and merges the keys it needs into `settings.json`. It
backs up `settings.json` and merges with `jq`, so it leaves your existing settings alone and is safe
to re-run, including on other machines. Requires `jq`. The autonomy features require `tmux`.

## Platform support

The scripts are POSIX-style `bash` and avoid GNU-only flags (epoch and timestamp formatting work on
both BSD and GNU `date`), so they run the same on Linux and macOS.

| Platform | Context check | Catch-up + skills | Armed-pane autonomy / self-clear |
|---|---|---|---|
| Linux | yes | yes | yes (needs `tmux`) |
| macOS | yes | yes | yes (needs `tmux`) |
| Windows via WSL | yes | yes | yes — run `claude` inside the WSL distro, where `tmux` works |
| Windows native (no WSL) | with Git Bash | with Git Bash | no — `tmux` is not available |

On Windows, use WSL: install and launch `claude` inside the Linux distro and everything works as it
does on native Linux. The autonomy harness drives a session by typing into its own `tmux` pane, which
has no native-Windows equivalent, so without WSL only the context check and the by-hand catch-up
apply. Requirements everywhere: `bash` and `jq`; add `tmux` for the autonomy features.

## Managed vs. autonomous panes

Arming is per pane.

| | plain `claude` | armed pane |
|---|---|---|
| Catch-up | reminder only; you send the first prompt | sends its own first prompt |
| Self-clear | not allowed; you manage context | allowed, after the gate below |

To arm a pane, launch it with `~/.claude/claude-armed.sh`, or tell the agent to go autonomous
mid-session and it runs `~/.claude/arm-session.sh on` (`off` turns it back off). A plain `claude`
session stays under your control.

## Self-clear gate

A pane clears itself only after both steps:

1. `/kijito-qa-memory` curates memory, writes a current-state note that begins with `RESUME NOW:`,
   and confirms with a fresh subagent that a cold start can resume. It records a pass token.
2. `self-clear.sh` checks that the kill switch is off, the pane is armed, it is not a subagent, it is
   in tmux, the target pane is alive, and the pass token is **fresh**.

Every one of those is a property of *this* clear — above all, "is the handoff good enough to survive
it?" A count-based cycle cap and an every-N human checkpoint used to sit here too and were removed on
2026-07-29: measured over 88 cycles they accounted for 19 of 24 refusals and never once caught a
loop, because a count measures uptime, not runaway. If a runaway ever needs catching, detect the loop
(consecutive cycles landing no commits and no memories) rather than the count.

It then runs `/clear`. The SessionStart hook catches the new session up and it resumes from the note.
To stop all autonomous sending and clearing, create the file `~/.claude/.lifecycle/STOP`.

## Running without Kijito

The context check (`myctx.sh`) has no dependencies; install and run it.

For the autonomy harness, set `KIJITO_MODE=off` for a generic catch-up prompt, or set your own with
`KIJITO_AUTOCATCHUP_PROMPT`. The self-clear gate only requires that some curation step write the pass
token (`~/.claude/kijito-qa-pass.sh`). Kijito is the default backend, not a requirement.

## Tests

```bash
bash tests/lc_test.sh
```

Covers arming, the token gate (both directions — a stale handoff refuses, a fresh one fires), the
kill switch, auto-send, and a regression guard that the removed count gates stay removed.

By default this exercises the scripts **in this repo** — the ones that actually ship. Set
`KIJITO_TEST_TARGET=installed` to run it against `~/.claude` instead, and `bash tests/drift_test.sh`
to report when those two disagree.

The rest of the suite:

```bash
bash tests/drift_test.sh                     # does this machine RUN what the repo SHIPS?
bash tests/conformance_test.sh --selftest    # every provider states the shared doctrine
node --test providers/codex/test/codex-hive-watch.test.mjs \
             providers/codex/test/release-packaging.test.mjs   # codex controller + packaging
node providers/codex/tools/refresh-manifest.mjs --check        # codex gated hashes are current
```

`drift_test.sh` covers both lanes — `providers/claude/` against `~/.claude`, and
`providers/codex/skills/` against `~/.codex/skills`. The codex lane is why it exists: those two skills
once lived *only* as installed state with no upstream in any repository, so a machine reinstall would
have destroyed them. `conformance_test.sh --selftest` first proves none of its own matchers can match
an empty document, because a prose check that accepts anything reports green forever.

## License

Apache 2.0. Copyright 2026 Arcada Labs. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

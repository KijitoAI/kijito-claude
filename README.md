# kijito-claude

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

Or, once the v0.1 packages are published, with a package runner (no clone needed):

```bash
npx kijito-claude       # via npm
pipx run kijito-claude  # via PyPI  (uvx kijito-claude also works)
```

Both package runners do the same thing as the from-source install: they bundle the scripts and
skills and run `install.sh`. They need `bash`, so on Windows run them inside WSL (see Platform
support).

The installer copies the scripts to `~/.claude/`, deploys the skills to `~/.claude/skills/`, drops
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
2. `self-clear.sh` checks that the pane is armed, is in tmux, has a fresh token, and is under the
   cycle cap.

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

Covers arming, the token gate, the cycle cap, the checkpoint, the kill switch, and auto-send.

## License

Apache 2.0. Copyright 2026 Arcada Labs. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

# kijito-claude

Tools for Claude Code sessions to track their own context window and, optionally, run unattended.
A session can catch up on memory at startup, report how much of its context window is actually in
use, and recycle its context at high usage without losing the working state. It uses
[Kijito](https://kijito.ai) as the memory backend by default, and also runs standalone (see
"Running without Kijito").

## Components

| Component | What it does | Needs Kijito |
|---|---|---|
| `myctx.sh`, `statusline-context.sh` | Report actual context-window usage from the API token counts recorded in the session transcript (the same numbers `/context` shows). Cheap to call. The statusline shows it live. | No |
| Session catch-up (`session-catchup-hint.sh`, a SessionStart hook) | Each session catches up on memory and notes before it starts on the task. | Optional |
| Armed-pane autonomy (`claude-armed.sh`, `arm-session.sh`, `session-autosend.sh`) | An armed tmux pane sends itself a first prompt and continues preloaded work. Arming is per pane, so one pane can run unattended while you drive another. | Optional |
| Self-clear loop (`self-clear.sh`, `lifecycle-lib.sh`, `kijito-qa-pass.sh`) | At high measured context, the session curates memory, confirms a fresh session can resume, runs `/clear`, then catches up again and continues. Gated so it will not clear with unsaved work. | Optional (see note) |
| `kijito-qa-memory` skill | Memory curation that requires writing the new memories (not only fixing existing ones), then uses a fresh subagent to confirm a cold start can reconstruct the work. | Yes |

The self-clear loop needs some durable store to carry the handoff across `/clear`. That is Kijito by
default; a notes file works in standalone mode.

## Install

```bash
git clone https://github.com/ArcadaLabs-Jason/kijito-claude
cd kijito-claude && ./install.sh
```

The installer copies the scripts to `~/.claude/` and merges the keys it needs into `settings.json`.
It backs up `settings.json` and merges with `jq`, so it leaves your existing settings alone and is
safe to re-run, including on other machines. Requires `jq`. The autonomy features require `tmux`.

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

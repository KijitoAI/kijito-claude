# kijito-claude

A toolkit for running **Claude Code** sessions that know their own context and can run themselves —
catch up on memory at start, measure real context usage (not a guess), and, when armed, recycle their
own context without losing the thread. Built around [Kijito](https://kijito.ai) as the memory backend,
but the harness works standalone (see **Works without Kijito**).

## What's in it

| Component | What it does | Needs Kijito? |
|---|---|---|
| `myctx.sh` + `statusline-context.sh` | Report **real** context-window usage from the API's own token ledger (matches `/context`). Cheap to call (~2 tokens); a statusline shows it live. | **No** — fully standalone |
| Session catch-up (`session-catchup-hint.sh` SessionStart hook + CLAUDE.md doctrine) | Every session starts *continuous*: catch up on memory/notes before the task. | Optional |
| Armed-pane autonomy (`claude-armed.sh`, `arm-session.sh`, `session-autosend.sh`) | An **armed** tmux pane instigates its own first turn (auto catch-up) and continues preloaded work. Per-pane opt-in — run one autonomous while you drive another. | Optional |
| Self-clear loop (`self-clear.sh`, `lifecycle-lib.sh`, `kijito-qa-pass.sh`) | At high *measured* context, recycle cleanly: curate memory → cold-boot-verify → `/clear` → re-catch-up → resume. Hard-gated; never loses unsaved work. | Optional* |
| `kijito-qa-memory` skill | Enforced memory curation (create **then** correct) + a cold-boot verification that proves a fresh session can resume. | **Yes** |

\* the self-clear loop needs *a* durable store to carry the handoff across `/clear` — Kijito by default; a plain notes file works in standalone mode.

## Install

```bash
git clone https://github.com/ArcadaLabs-Jason/kijito-claude
cd kijito-claude && ./install.sh
```
Idempotent + non-destructive (backs up `settings.json`, jq-merges keys). Re-run on any machine to deploy the same setup. Needs `jq`; `tmux` for the autonomy features.

## Mental model: managed vs. autonomous (per pane)

| | plain `claude` | armed pane |
|---|---|---|
| Catch-up | passive reminder (you prompt) | auto-fires, instigates its own turn |
| Self-clear | **refused** — you manage context | permitted (after the gate below) |

**Arm a pane** (any of): launch `~/.claude/claude-armed.sh`; or mid-session tell the agent "go autonomous" → it runs `~/.claude/arm-session.sh on` (`off` to hand back). Plain `claude` is yours to manage.

## The self-clear gate (why it won't lose your work)

A pane may `/clear` itself **only** after: (1) `/kijito-qa-memory` curates + preloads a `RESUME NOW:` handoff pointer + **cold-boot-verifies** a fresh agent can resume (writes a pass token); (2) `self-clear.sh` checks: armed · in tmux · fresh token · under a cycle cap. Then `/clear` → SessionStart re-catches-up → resumes the preloaded work. **Kill switch:** `touch ~/.claude/.lifecycle/STOP` halts all autonomous send/clear.

## Works without Kijito

- **Context self-check** needs nothing — install and run `~/.claude/myctx.sh`.
- **Autonomy harness:** set `KIJITO_MODE=off` for a generic catch-up prompt (or set your own via `KIJITO_AUTOCATCHUP_PROMPT`), and have any curation step write the pass token (`~/.claude/kijito-qa-pass.sh`) — that's the only contract the self-clear gate enforces. Kijito is the *reference* memory backend, not a requirement.

## Tests

`bash tests/lc_test.sh` — exercises every gate (arming, token, cycle cap, checkpoint, kill switch, autosend).

## License

Apache License 2.0 — © 2026 Arcada Labs. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
(Apache 2.0 for its explicit patent grant + retaliation clause — appropriate for patent-holding projects.)

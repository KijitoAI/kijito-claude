---
name: kijito-start
description: Catch up at the start of a session so you continue rather than restart. For an existing persona — load memory, read the current-state pointer and recent lessons, arm the inbox, and resume any active work. For a brand-new persona/project — establish identity from CLAUDE.md, set up the inbox, and create the current-state pointer. Use on the first action of a session, after a /clear, or after compaction. Optional: this is a handful of tool calls you can run by hand; the skill just makes the routine uniform and one command.
---

# Kijito Start — begin continuous, not cold

Every session begins in the middle of ongoing work, not from zero. Kijito (local daemon, `mcp__kijito__*`) holds what the last session learned; this skill loads it before you touch the user's task, so you act on accumulated context instead of guessing.

**This is optional.** The catch-up is just a few Kijito calls — `kijito_startup`, a couple of `kijito_get`s, an inbox check — and you can do them by hand any time. The skill exists because it is easy to deploy and runs the same way every session, not because the steps are hard. A SessionStart hook can also remind you passively; this skill is the active, thorough version.

## Phase 0 — which branch are you on?

Run `kijito_startup(persona="<P>", project="<J>")` with the persona/project your `CLAUDE.md` assigns (project `CLAUDE.md` first, then `~/.claude/CLAUDE.md`). Pass them explicitly; do not rely on auto-discovery.

- It returns identity + recall + recent + goals, and reports whether your persona already exists.
- **Existing persona** (has memories, an identity, a current-state pointer) → **Path A**.
- **Brand-new persona/project** (no identity memory, empty inbox, nothing to resume) → **Path B**.

## Path A — existing persona: catch up deeply, then resume

1. **Read the pointer in full.** `kijito_startup` truncates content. `kijito_get` the current-state / next-steps pointer it names, then `kijito_get` the memories that pointer links. Do not work from previews — the load-bearing detail is in the full text.
2. **Skim recent lessons.** `kijito_recent` (last 24–48h) and `kijito_recall("lessons gotchas <your project>")`. These are how you avoid repeating a mistake the last session already paid for.
3. **Distrust stale operational facts.** Memories about how something works (paths, ports, config, deploy steps) are the ones most often wrong after time passes — recall flags them as stale. Verify a load-bearing one against reality (code / config / a quick command) before you act on it.
4. **Arm your inbox.** Check `kijito_hive_inbox(persona="<P>")` for durable messages from sibling personas. If the inbox monitor runs here, also tail your own stream for live events (`~/.cache/kijito-inbox-monitor/events.<P>.ndjson`); do not start your own watcher if a supervised producer already runs.
5. **Resume or report.** If the pointer shows ACTIVE WORK and you were auto-started on an armed pane, continue it autonomously to its DONE-WHEN — do not wait for a prompt. Otherwise, report where things stand and wait for the user.

## Path B — brand-new persona/project: set up identity first

Do this **before writing any memory**, or the first writes land under the wrong owner and contaminate the graph.

1. **Read the briefs.** Project `./CLAUDE.md` and `~/.claude/CLAUDE.md` — they tell you who you are here (persona, project, the rules of this codebase).
2. **Fix the wiring if needed.** If `mcp__kijito__*` tools are absent, the project is missing `.mcp.json` (server `kijito` → `http://127.0.0.1:7474/mcp/`, type `http`) and `.claude/settings.local.json` (`"enableAllProjectMcpServers": true`). Add them; new MCP tools load only on a fresh launch.
3. **Write the identity memory.** One memory establishing persona + project + what this work is. Pass `persona` + `project` on it (and on every write after).
4. **Open the inbox.** The first `kijito_hive_inbox(persona="<P>")` provisions the inbox; a brand-new persona just gets an empty one (not an error).
5. **Create the current-state pointer.** A stable memory you will `kijito_update` in place going forward — record its ID. A cold boot has nothing to read otherwise. Open it with the active task and next step (or "no active work yet" if you are only setting up).
6. **Report ready.**

## Failure modes to counter

- **Skimming the pointer.** Truncated previews read fine and mislead; `kijito_get` the full text of the pointer and its linked memories.
- **Skipping the inbox.** A sibling persona may have handed you something or be blocked on you. Always check.
- **Wrong-owner writes (new personas).** Set persona/project before the first write. `personal` / a mismatched name pollutes recall and is rejected on later edits.
- **Acting on a stale operational fact.** Verify how-it-works memories against the real system before trusting them.

## Done report

State plainly: which branch you took; the persona/project; the current-state pointer ID; what the pointer says is active (or that there is none); whether the inbox had anything; and whether you are resuming work or waiting. If a fresh read could not tell what to do next, the pointer is too thin — fix it now with `/kijito-qa-memory` rather than leaving the next session to guess.

## Notes

- Reproducible from Kijito: the routine is also stored in the graph — `kijito_recall("session start catch-up routine arm inbox")` — so any agent can recover it without this file.
- Pairs with `/kijito-qa-memory`: that one curates and preloads the handoff at the END of a session; this one consumes that handoff at the START. Together they make a session continuous across `/clear`.

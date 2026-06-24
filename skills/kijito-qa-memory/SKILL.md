---
name: kijito-qa-memory
description: Rigorous Kijito memory curation with enforced creation + cold-boot verification. Use when winding down a session, before /clear or self-clear, when asked to "QA / curate / clean up memory", when preparing a handoff for the next session, or any time you need to be sure a fresh session could continue the work. Counters the two chronic failure modes — treating "QA" as corrections-only (skipping creation), and never confirming the memory actually works in a cold context.
---

# Kijito QA Memory — curate the graph, then PROVE it works cold

Kijito (local daemon, `mcp__kijito__*`) is the only thing that survives a `/clear` or a new session. "QA memory" is not "fix a few wrong notes" — it is **make the graph match what this session actually learned, then confirm a cold agent can act on it.** Pass your persona/project on every write.

## The bias this skill exists to defeat

You will, by default, do two wrong things — counteract both deliberately:
1. **Collapse QA to corrections-only.** The creation gap is *invisible* (you can't see the memory you never wrote), so "QA" silently becomes "tidy existing notes." **Creation is half the job and it is the half that gets skipped. Do it FIRST and exhaustively.**
2. **Assume done instead of confirming.** You'll declare the handoff good without ever testing it cold. **A curation is not complete until a fresh, context-free agent reconstructs the work from memory alone.** This is non-negotiable and is the step you'll be tempted to skip.

Run the phases in order. Do not declare done until Phase 4 passes twice (2-green).

## Phase 1 — CREATE (exhaustive, do this FIRST)

Enumerate EVERY candidate insight from this session — don't filter yet:
- decisions made · findings/results · bugs found · lessons & gotchas · reusable recipes/commands · state changes · things you now believe that you didn't before · corrections to prior belief.

For each candidate ask: **"Is this already an atomic memory?"** If not, write it now:
- one insight per memory (if you wrote "5 things about X", that's 5 memories);
- front-load the exact words a later search/teammate would use;
- set `persona` + `project`; pick honest `importance` (don't inflate; 0.85+ never decays).

Then apply the **completeness gate**, out loud: *"What did I learn this session that is NOT yet written?"* — and EXPECT to find gaps. List them, write them. Only move on when that question returns nothing.

## Phase 2 — CORRECT / STALENESS

`kijito_recall` each topic you touched this session. For every memory that is now **wrong or changed** → `kijito_correct` (fades old + links the fix; never edit history). **Obsolete** → `kijito_fade`. Operational/"how X works" memories are the most dangerous when stale — verify against reality (code/config/files) before trusting or correcting.

## Phase 3 — PRELOAD THE HANDOFF (the current-state pointer)

Update your living current-state / next-steps pointer (e.g. a stable memory you `kijito_update` in place) so it ALONE drives the next session:
- **OPEN with an imperative to continue** — `RESUME NOW: <next concrete action>` — not a description, or the next session asks "what should I work on?" instead of acting.
- then: the single active task · exact next steps · DONE-WHEN criteria · key anchor memory IDs.
- if **no pointer exists yet** (new persona/project), CREATE one as a stable memory and record its ID — that is your pointer from now on (a cold boot has nothing to read otherwise).
- if the work is **DONE** (DONE-WHEN met), do NOT write `RESUME NOW` — mark it COMPLETE so the next boot reports done. A stale imperative on finished work causes an infinite self-clear loop.
- if self-managing an **autonomous workstream**, `kijito_hive_claim` it first so a concurrent same-persona session can't clobber the handoff; release when done.

## Phase 4 — COLD-BOOT VERIFY (confirm, don't assume — DO NOT SKIP)

Prove the memory works in a context that has never seen this conversation. Spawn a **fresh general-purpose subagent** (NOT a fork — a fork inherits your context and would cheat the test). Give it only this:

> You are a brand-new session. Connect to Kijito and cold-boot: `kijito_startup(persona="<P>", project="<J>")`, then read the current-state pointer it names and the memories it links. Using ONLY what Kijito returns (you have no other context), report:
> 1. the single active task in progress,
> 2. the exact next step to take right now,
> 3. what is already done vs. not,
> 4. the DONE-WHEN criteria,
> 5. anything ambiguous, missing, or contradictory.
> Do not guess or infer beyond what the memories say — if it isn't in memory, report it as a GAP.

Compare its report to ground truth:
- Reconstructs task + next step + DONE-WHEN correctly, no load-bearing gaps → **PASS**.
- Misses, garbles, or flags a real gap → **FAIL**: that gap is a missing/weak memory → go back to **Phase 1/3**, fix the *specific* gap, re-run.

**2-green:** repeat Phase 4 until two consecutive cold boots reconstruct cleanly. Finding any issue resets the count.

## Done report

State plainly: N memories created, N corrected, N faded; the current-state pointer ID; and the cold-boot verdict ("a fresh agent reconstructed the active task + next steps + DONE-WHEN, 2 consecutive clean boots"). If you cannot say that, you are not done.

**Then record the pass:** run `~/.claude/kijito-qa-pass.sh`. This writes the token `self-clear.sh` requires — without a passing cold-boot verify you cannot self-clear, by design. The token is consumed by one `/clear`, so each recycle needs a fresh kijito-qa-memory pass.

## Notes

- This skill IS the memory half of the self-clear gate: a session may only self-`/clear` after this passes (then the next session resumes from the pointer).
- Reproducible from Kijito: the procedure is also stored in the graph — `kijito_recall("kijito-qa-memory skill procedure cold-boot verify")` — so any agent on any machine can recover or rebuild it even without this file.

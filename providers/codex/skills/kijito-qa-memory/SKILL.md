---
name: kijito-qa-memory
description: Curate and verify Codex memories in the hosted Kijito brain before native compaction, handoff, or session completion. Create missing durable memories, correct false ones, fade obsolete ones, update the current-state pointer, require two consecutive context-free cold boots, and request compaction only after recording the one-use pass.
---

# Kijito QA Memory

Memory QA is creation, correction, handoff preload, and proof. Run the phases in
order. A compaction handoff is not valid until Phase 4 passes twice.

## 1. Create missing memory first

Enumerate every durable decision, finding, state change, user preference,
failure mode, reusable command, and gate result learned since the last QA pass.
For each candidate, recall before writing and create one atomic memory only when
it is missing. Pass `persona="codex"` and `project="Codex"` on every write.
Use honest basis, confidence, and importance.

Ask both questions explicitly, and answer both before leaving this phase:

1. Existence: “What did this session learn that is not written yet?”
2. Adequacy: “Is any memory I wrote a list of the cases I happened to hit
   rather than the property that decides new ones?” A memory can be present,
   accurate, and still be a rule with an expiry date: it fails silently on the
   first case its author did not foresee. Restate it as the property.

The existence question is the one that gets asked and the adequacy question is
the one that gets skipped. Repeat until both answers are nothing.

## 2. Correct and prune

Recall each topic touched:

- Use `kijito_correct` for wrong or superseded claims.
- Use `kijito_fade` for obsolete-but-still-true claims.
- Verify operational facts against current code, configuration, or live state.
- Do not treat account-wide recall as persona-private.

`kijito_correct` rots every inbound `[[id]]` citation pointing at the memory it
retires, and nothing warns you. It links forward, from the retired record to the
fix; nothing traverses backward. So a live memory citing the old id now points at
a record the server itself believes is false, and the more disciplined you are
the more of this rot you generate — correcting well is what causes it. After each
correction, find the inbound citers and re-point them at the live id with
`kijito_update` and `structural=true`, which preserves the operational-staleness
clock because bracketed digits carry no meaning.

Do not use the `Status:` field to detect a dead citation target.
`GET /api/memory/{id}` reports `Status: active` on believed-false records. Judge
liveness from `importance` (retired is at or below `0.1`) and `confidence`
(retired is near `0.05`).

After creation, correction, and pruning are complete, run `kijito_dream` now if
the curation batch warrants it. Dreaming can mutate themes and edges, so it
must finish before the final pointer update and before either cold boot. Do not
dream again after the pointer is preloaded.

## 3. Preload the pointer

Update the stable current-state pointer in place. Open with:

`RESUME NOW [CODEX_CURRENT_STATE_POINTER_V1]: <one exact next action>`

Include the single active task, done versus remaining work, current adversarial
gate count, exact next steps, DONE-WHEN, and linked anchor IDs. If the work is
actually complete, remove `RESUME NOW` and mark it complete. Keep the literal
sentinel out of every live support memory so exact recall remains pointer-only;
retired version-history snapshots are the audit-only exception.

## 4. Prove two clean cold boots

Before spawning either boot, obtain the exact `pointer-digest.mjs` command and
the exact `qa-gate.mjs record` command emitted by the active hook. If either
command is unavailable, stop: do not invent a plugin path and do not claim a
pass. Replace only `REPLACE_WITH_POINTER_ID` in the digest command at this
stage. Keep the record command unused until Phase 5. Establish a single-writer
pointer lease: no other seat may mutate the current-state pointer from the
first boot's before-read digest through the final record action. If that
discipline cannot be confirmed, keep compaction blocked.

Spawn a fresh context-free agent with no conversation fork. Give it only:

> Run this exact pointer-digest command immediately before reading Kijito:
> `<EXACT HOOK-EMITTED POINTER-DIGEST COMMAND>`. Record its pointer ID and
> lowercase digest. Then connect to Kijito as persona `codex`, project `Codex`.
> Call `kijito_startup`, then call
> `kijito_recall(query="CODEX_CURRENT_STATE_POINTER_V1 RESUME NOW", scope="project", project="Codex", full=true)`.
> Require one unambiguous top current-state result whose ID equals the pointer
> ID embedded in the supplied digest command; otherwise fail immediately.
> Scan every returned live memory and fail if any body other than the selected
> pointer contains the literal sentinel.
> Then read that pointer and every live, load-bearing linked
> memory. A server-generated predecessor marked `Source: version_history` is retired audit history regardless of importance.
> A predecessor identified only by a `version_of`/`derived:version_of` edge is retired audit history when its importance is at or below `0.1`.
> A matching predecessor is never a candidate current instruction: note that it exists, but do not follow or compare any
> `RESUME NOW` directive in its body.
> If archive status is ambiguous, fail the boot. Using only Kijito between the
> two digest commands, report the active task, exact next step, done versus
> remaining, DONE-WHEN, and every ambiguity or contradiction. Do not re-check
> defects the pointer already names as fixed — those are the ones most likely
> handled; hunt instead for siblings of those classes in places nobody has looked
> yet. Do not inspect files or guess. Immediately after reading and evaluating the pointer, run the
> same exact pointer-digest command again. Require the before-read and after-read pointer IDs and digests to be identical.
> Report the
> recall-selected ID and digest as one verified pair, but never the pointer
> body. These two invocations of the exact digest command are your only
> non-Kijito actions.

Compare its result to ground truth.

Severity gate. Only a finding that would cause a cold agent to take a WRONG
ACTION resets the count. An ambiguity, a cosmetic inconsistency, or a “could be
clearer” is recorded in the handoff as known-open and does not reset. Ask of each
finding: would an agent acting on this do the wrong thing?

Remediate by CLASS, never by instance. Before repairing anything, name the class
the finding belongs to, sweep every sibling location that could hold the same
class — the other memories, the pointer, the linked anchors — and fix them
together in one pass. Repairing only the instance the verifier named makes each
round surface one more member of the same class, so the loop runs in
O(instances) instead of O(classes), and it looks like diligence the entire way.

Hard cap: three rounds. “Any finding resets the count” plus an adversarial
verifier reading a rich pointer means findings are always available, so this loop
is non-terminating by construction: termination would otherwise depend on the
reviewer running out of things to say. A stated gap costs one sentence and fixing
it costs a whole round, which is why the loop conflates disclosed with fixed. At
the cap, stop, write every residual into the handoff, and mark the pass complete.
A residual you have disclosed is not a residual you have hidden. A stronger model
converging in one pass is not the fix — that makes the stopping condition depend
on the agent's judgement, which is a piece of advice, not a guard.

Require two consecutive clean passes.
Each boot must prove its own before-read digest equals its after-read digest,
and both clean boot reports must name the same pointer ID and digest. A missing,
malformed, or different digest is a failed boot and restarts both.

## 5. Record the one-use pass and request native compaction

Only after Phase 4 is 2/2 green, run the same exact hook-emitted
`pointer-digest.mjs` command once more, immediately before recording. Require
its pointer ID and digest to equal both cold-boot reports. If it differs or
fails, the pointer changed and both boots restart.

Then replace `REPLACE_WITH_POINTER_ID` and
`REPLACE_WITH_POINTER_DIGEST` in the exact hook-emitted `qa-gate.mjs record`
command with those verified values. Make no pointer edit after either clean
boot or this final digest check, and do not permit another seat to edit it
during the final-check-to-record window. Run the record command as the final
memory-QA action. The token attests that specific pointer revision plus the
session and transcript; it is private, fresh for 30 minutes, and consumed by
one compaction.

The successful record command emits a machine-readable
`kijito.compaction.ready` signal with a cryptographic per-compaction nonce.
Immediately request native Codex compaction through the adapter that already
owns the active thread:

- An app-server host calls `thread/compact/start` for that exact thread.
- A Codex CLI supervisor may submit the literal `/compact` command to its
  explicitly pinned pane.

The request is not authorization: `PreCompact` independently validates and
atomically promotes the pass into the one-use nonce-bound re-entry ticket.
`PostCompact` alone claims that ticket and owns Kijito re-entry;
`SessionStart(compact)` is a no-op. Do not call `thread/resume`, create a
replacement app-server connection, guess a thread or pane, inject arbitrary
keystrokes, or substitute `/clear`. If the current host exposes no safe
preemptive trigger, report that autonomous recycle is unavailable on that
adapter; never wait for forced automatic compaction or claim that compaction
occurred.

The pass cryptographically binds the exact pointer content only. The cold boots
also provide best-effort resumability verification of linked and recall-reached
memory as it existed during their bracketed reads, but the token does not
cryptographically cover that unbounded graph surface or later changes to it.
Normal runtime is single-writer-of-own-handoff; the advisory pointer lease
prevents concurrent development seats from creating a false gate during QA
without pretending to be a graph-wide lock.

`PreCompact` deliberately performs no network request. It format-validates and
reports the attested revision but does not refetch the hosted pointer. The
workflow ordering above—not a runtime network comparison—prevents a stale
attestation from being used after an in-place pointer edit.

If no exact hook command is available, report that the pre-compaction token
could not be recorded and keep compaction blocked.

After the record action, report counts created/corrected/faded, the pointer ID,
the two cold-boot verdicts, whether the one-use pass was recorded, its readiness
nonce, and whether native compaction was requested. Do not call `kijito_dream`
or any other graph-mutating tool after recording.

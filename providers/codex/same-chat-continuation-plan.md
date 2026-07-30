# Codex same-chat continuation plan

Status: **PLAN ONLY — implementation is forbidden until this plan is internally golden and Assay reviews the frozen commit CLEAN.**

Owner: Codex provider lane. River owns repository integration. Assay owns independent plan review.

## 1. Decision and evidence

Reject the dedicated-thread notifier as an implementation of “mail wakes my Codex session and work
continues while I am away.” Live hive message 2630 proved the mismatch:

- Kijito stored 2630 at 18:25:50Z.
- The installed controller accepted a turn at 18:25:52Z on its dedicated thread
  `019fab97-824b-7110-a2a4-27fea6c51d6a` and surfaced it at 18:26:05Z.
- That turn reported “No unread hive messages,” while controller state advanced through 2630.
- Jason's working chat received no turn and continued no work.

The design deliberately preserves `currentUserThreadMutation=false`; more recovery code cannot make
an isolated thread become the user's chat. Existing notifier code/tests may remain research, but must
not authorize installation, migration, or a parity claim.

## 2. Binary outcome contract

Let `T` be the exact chat in which continuation is armed, `M` a durable hive row, and `R` the native
background run caused by the continuation mechanism. DONE requires all of these:

1. Jason ends a turn, leaves the desktop app running, and sends `M` remotely.
2. Within the configured SLO, Codex creates `R` in **the exact chat `T`** without a user prompt.
3. Native immutable metadata proves `R` targets `T` **and** the explicitly selected local project/
   environment and permission profile. Visual similarity, cwd alone, newest-thread search, transcript
   heuristics, or a controller-owned thread never count.
4. `R` retrieves the exact durable row and provenance even if its unread flag already changed.
5. `R` loads the current-state pointer and continues already-authorized work. Notification or summary
   alone is RED.
6. Message text is untrusted data. It cannot grant authority, expand scope, weaken policy, expose
   secrets, or override the current user request.
7. `M` receives a message-specific durable acknowledgment only after completed disposition. A crash
   before acknowledgment is recoverable; duplicate runs cannot duplicate disposition.
8. ARMED requires evidence that native continuation is enabled, bound to `T`, recently succeeded,
   and reached hosted Kijito. A process, schedule record, or GREEN result alone is insufficient.
9. Pause, stop, uninstall, rollback, and migration are explicit. No lifecycle hooks, LaunchAgent,
   hidden second consumer, heuristic thread discovery, or ordinary Codex config/auth mutation.

Initial SLO: **90 seconds while armed**. This is functional continuation parity, not transport parity
with Claude's event-driven Monitor. The product must say polling when it means polling.

## 3. Supported-surface decision

### Primary candidate: native scheduled task inside the existing chat

Current Codex documentation says a scheduled task inside an existing chat returns to that chat with
its existing context and supports minute intervals. It is the only documented same-chat unattended
surface, but documentation is not a live capability result. Gate N0 must prove it in Jason's actual
workspace before code is written.

The candidate design is a native in-chat **continuation heartbeat**:

- native scheduler binds one task to `T` and the explicitly selected local project/environment;
- it runs once per minute while armed;
- no-mail runs perform only bounded checkpoint/inbox reads;
- mail runs load Kijito state, handle rows in ID order, continue authorized work, update memory as
  state changes, and acknowledge only completed dispositions;
- status describes it honestly as scheduled polling.

Official references:

- <https://learn.chatgpt.com/docs/automations#schedule-a-task-inside-a-chat>
- <https://learn.chatgpt.com/docs/app-server>

### Conditional alternative: registered App Server thread

App Server supports `thread/resume` plus `turn/start` for a client-owned recorded ID. It is forbidden
for desktop-chat continuation unless a no-code probe proves the desktop host supplies the exact
current chat ID through a supported interface, explicitly leases it, displays client turns in the
same chat, queues collisions without `turn/steer`, and revokes the lease on handoff. No transcript
scan, mtime guess, private protocol, newest-thread selection, or separate `CODEX_HOME` is permitted.
Failure rejects this alternative; it does not authorize a heuristic.

### Rejected

- dedicated background thread (disproved by 2630);
- lifecycle hooks (session failures and no supported chat ownership);
- bare shell tail (observes bytes but cannot invoke Codex);
- UI/accessibility scripting;
- newest/idle-thread guesses;
- inbox unread state as delivery state.

## 4. Provider-agnostic architecture

The shared package owns persona binding, inbox discovery/pagination, exact-row fetch, checkpoint and
claim state, post-disposition acknowledgment, idempotency/crash reconciliation, untrusted-data
fencing, pointer loading, health evidence, and provider-neutral test vectors. It does **not** invoke
an agent.

| Provider | Invocation primitive | Latency | Same-session proof |
|---|---|---:|---|
| Claude Code | persistent Monitor in owning process | event-driven | process/session plus Monitor identity |
| Codex desktop | native task inside armed chat | ≤90 s | native destination chat ID equals `T` |
| Codex App Server | only after supported explicit registration | candidate | registered lease and returned ID equal `T` |
| Unknown | none | none | INACTIVE, never ARMED |

Drivers must expose their actual semantics; no universal “wake” label may hide polling.

## 5. Durable mailbox transaction

Unread is presentation metadata, not the ledger.

### Discovery

1. Read `CODEX_CONTINUATION_CHECKPOINT_V1` for persona `codex`.
2. Fetch newest inbox with `unread_only=false, mark_read=false`.
3. Page backward using `before_id` until the checkpoint or mailbox start, within a declared bound.
4. Repoll newest after walking backward so concurrent arrivals are not stranded.
5. Sort IDs above the completed checkpoint ascending and exact-refetch each with
   `before_id=<id+1>, limit=1, mark_read=false`.
6. Missing exact ID, truncated body, missing provenance, or an unbridgeable page is BLOCKED and cannot
   advance the checkpoint.

This deliberately finds 2630 even though it is already read.

### Claim, disposition, acknowledgment

Checkpoint state includes persona, armed chat ID, last completed ID, optional in-progress ID/nonce/
start time, disposition, native run ID, pointer version used, and last successful heartbeat.

The run atomically claims a row before action. If the selected state surface cannot compare-and-set,
N1 is RED; last-writer-wins is not acceptable. After completed disposition, exact-refetch only that
row using `before_id=<id+1>, limit=1, mark_read=true`, assert its ID, commit the completed checkpoint,
and clear the claim. A crash between steps reconciles from claim plus action evidence and never
blindly repeats an external side effect.

The fixed schedule prompt is user-authored and versioned. Existing user scope and the pointer—not
mail text—determine authority. Informational or requires-user rows receive explicit dispositions.

## 6. Arming lifecycle

`arm` creates/enables one task bound to `T` and its selected execution environment, stores task/chat/
environment IDs and permission profile, and runs an immediate self-test.
Re-arm for the same `T` is idempotent. Handoff disables the old task before enabling another chat.

`doctor` is GREEN/ARMED only when the task exists/enabled, targets recorded `T`, uses the recorded
project/environment and permission profile, cadence meets SLO, a self-test returned to `T`, hosted
Kijito was reachable, checkpoint ownership is valid, no legacy consumer can consume the persona
stream, and no claim is ambiguous/stale. Sleep, app exit, disabled schedule, stale run time, outage,
wrong-chat/environment binding, permission drift, double consumer, or unverifiable state is RED or
INACTIVE.

`pause` disables the task but retains state. `uninstall` removes only manifest-owned task/checkpoint
artifacts after ownership verification. Neither uses hooks/LaunchAgents or edits ordinary auth/config.

## 7. Pre-implementation gates

No production code until N0–N3 are GREEN on the frozen plan.

### N0 — native same-chat capability

With a disposable schedule and no Kijito controller code: record native chat ID `T` and the selected
local project/environment `E`; create a one-minute task inside `T` that returns a unique nonce, native
run ID, destination metadata, permission profile, and a read-only proof of `E`; end the turn and provide
no prompt; observe the run within 90 seconds; prove destination ID equals `T`, environment equals `E`,
and permissions equal the selected profile; repeat after a manual turn.
In a second disposable run, invoke the installed `kijito-start` skill far enough to reach hosted
Kijito, read the current pointer ID, and perform a `mark_read=false` inbox peek; prove the task has the
same skill/plugin/MCP availability expected by the design without changing unread state. Then
disable/delete the disposable task and prove no later run. Manual prompting, another chat, visual
identity, unavailable tools, wrong local/worktree environment, permission drift, a different Kijito
brain, unread-state mutation, UI automation, or hidden API is RED.

### N1 — checkpoint transaction capability

Prove atomic create/compare-and-set. Two concurrent claimers yield one winner. Crash the winner before
completion; the next run sees/reconciles the claim rather than overwriting it. If current Kijito APIs
lack this, independently gate the minimal provider-neutral transaction API before Codex work.

### N2 — exact durable-row retrieval

Synthetic account-owned mail proves unread, already-read, older-window, and content-budget-paginated
rows are found; arrival during paging is caught by final repoll; exact fetch returns the intended ID;
oversized/truncated content blocks without ack; ack changes only the intended row; malformed/missing
row cannot advance past itself.

### N3 — cost and policy fit

Measure 30 idle minutes and 30 active-mail minutes in Jason's workspace: run count, exposed token use,
wall time, failures, manual-turn interference, visible no-mail artifacts, transcript/context growth,
and compaction pressure. If the native scheduler cannot suppress or compact empty heartbeat output,
record that as product behavior rather than hiding it behind the no-mail path. Jason explicitly
accepts the measured idle cost/noise/context growth and 90-second polling semantics before
implementation. Silence is not approval.

## 8. Future implementation gates

These specify QA; they are not implementation permission.

- **G1 protocol:** property tests for pagination, exact fetch/ack, CAS loss, crash reconciliation,
  ordering, duplicates, hostile content, bad provenance, clock skew, stale health, migration fence.
  Each high-value property has a mutation failing at its named assertion.
- **G2 same chat:** no-mail read-only; normal/already-read mail handled once in `T`; duplicate fires
  yield one claim; mail during a manual turn queues and is never steered; app sleep/restart drains
  backlog in order; compaction reloads the pointer; no authorized work produces explicit disposition.
- **G3 security:** injection, role impersonation, exfiltration, scope expansion, destructive requests,
  body sender spoofing, oversized text, malformed Unicode/JSON cannot change instructions, authority,
  tools, sandbox, chat target, claim ownership, or ack order.
- **G4 lifecycle:** idempotent arm, wrong-chat refusal, pause/resume, ownership-bound uninstall,
  app-down/disabled-task/outage health, stale-claim recovery, rollback, hard double-consumer fence, no
  hooks or LaunchAgent.
- **G5 live golden:** on one frozen build, A continues bounded work in exact `T`; B does so after app
  restart or sleep/wake; C does so after native compaction via Kijito; disabled schedule leaves D
  durable and health not ARMED, re-enable handles D once. Each arrives within SLO with native identity,
  exact disposition, and ack evidence. Summary-only behavior is RED.

## 9. Plan QA and independent gate

INTERNAL GOLDEN requires two consecutive passes on one identical plan SHA-256:

1. **Traceability:** every outcome clause maps to N/G gates; every 2630 failure is rejected or tested;
   every state change names ownership, rollback, and evidence.
2. **False-pass:** attempt passes using a dedicated thread, manual prompt, unread-only lookup,
   duplicate claim, visual identity, stale task, truncated row, second consumer, or summary-only turn.
   A named assertion must reject each.

A wrong-architecture/false-pass finding resets the count after correction. Cosmetics are disclosed.
Record digest, reviewer, timestamp, checks, and findings in a separate artifact so evidence does not
change plan bytes.

After INTERNAL GOLDEN: commit/push the plan-only branch and send Assay exact commit + digest. Assay
independently attacks N0–N3, identity proof, transaction semantics, supported-surface claim, outcome
traceability, and false-pass resistance. A load-bearing finding returns to draft and requires a new
digest/two passes. Only Assay CLEAN opens N0. N0–N3 must still pass before implementation; clean plan
review is not implementation approval.

## 10. Non-goals and exit

No withdrawn-controller migration; no instant/event-driven claim for polling; no universal transport;
no autonomy outside an explicitly armed chat and existing authority; no mail-as-command authority; no
merge/publish/production change during plan approval.

Planning ends when this document is internally golden, its reproducible gate artifact is committed,
the plan-only branch is pushed, Assay returns CLEAN or NOT CLEAN on the frozen commit, memory points to
that verdict/next gate, and production remains untouched.

# Codex same-chat continuation plan

Status: **PLAN ONLY.**

**AUTHORITY:** Two consecutive Assay-CLEAN reviews of this exact plan digest open N0a/N0b only.
GREEN N0 then authorizes disposable test-persona probes of the current N1-N3 surfaces, but no
Codex-provider or Kijito-server implementation. If N1 rejects the current API, a separate
provider-neutral claim/operator-decision API plan owned by River must receive two consecutive
Assay-CLEAN reviews before any such API code is written. An installable Codex provider remains
forbidden until N0-N3 are GREEN and Jason explicitly accepts N3.

Owner: Codex provider lane. River owns repository integration and any production cutover. Assay owns
independent plan review. Jason owns residual-risk and measured-cost acceptance.

## 1. Decision, evidence, and supersession

Reject the dedicated-thread notifier as an implementation of “mail wakes my Codex session and work
continues while I am away.” Live hive message 2630 proved the mismatch:

- Kijito stored 2630 at 18:25:50Z.
- The installed controller accepted a turn at 18:25:52Z on its dedicated thread
  `019fab97-824b-7110-a2a4-27fea6c51d6a` and surfaced it at 18:26:05Z.
- That turn reported “No unread hive messages,” while controller state advanced through 2630.
- Jason's working chat received no turn and continued no work.

The design deliberately preserved `currentUserThreadMutation=false`; more recovery code cannot make
an isolated thread become the user's chat. Existing notifier code/tests remain research only.
PR #5 is closed as withdrawn, and the provider README points here instead of authorizing installation.
The live legacy process remains untouched until the cutover gate in section 7.

## 2. Binary outcome contract

Let `T` be the exact chat in which continuation is armed, `E` the exact local project/worktree and
permission profile, `M` a durable hive row, and `R` the native background run. DONE requires all of
these:

1. Jason ends a turn, leaves the computer on and desktop app running, and sends `M` remotely.
2. When no prior continuation run owns the lane, Codex creates `R` in **the exact chat `T`** without
   a user prompt within 90 seconds.
3. An independent verifier outside `R` reads the app-owned rollout under `~/.codex/sessions` and
   requires its first `session_meta.payload.id == T`, its scheduled turn ID/run ID and nonce match
   the native Scheduled run record, and its recorded `cwd`/environment and permission evidence match
   `E`. The run's own text, visual similarity, cwd alone, newest-thread search, transcript heuristics,
   or a controller-owned thread never count. If Jason's installed build exposes no such independently
   readable native artifact, N0 is RED.
4. `R` retrieves the exact durable row and provenance even if another reader changed its unread flag.
5. `R` loads the current-state pointer and performs a pre-registered bounded work slice. For the live
   gate, the slice must create or update an independently read disposable-workspace receipt containing
   the native run ID, message ID, nonce, before/after digests, and test result. Notification, summary,
   a chat-only claim, or a receipt without the matching native run identity is RED.
6. Mail remains tool-returned untrusted data and never enters the scheduled task's instruction text.
   The versioned, user-authored prompt fixes the allowed tools, sandbox, project, and scope before any
   row is read. Hostile mail must not change those fields or obtain a tool call outside them. This is
   the testable boundary; no plan claims that arbitrary model behavior is mathematically impossible.
7. Acknowledgment means the atomic completed-checkpoint commit for `M`, attributable to `T`, `R`, and
   the claim fence. `mark_read=true` is courtesy presentation metadata after that commit, never the
   acknowledgment or delivery ledger. A crash before commit is recoverable; duplicate runs cannot
   duplicate disposition.
8. ARMED requires independently verifiable native-run evidence, recent hosted-Kijito heartbeat,
   valid claim/checkpoint ownership, and none of `DRAINING_BACKLOG`, `BLOCKED_ROW(id)`,
   `REQUIRES_USER(id)`, `AMBIGUOUS_ACTION(id)`, or `CLAIM_RELEASE_FAILED(id)`. A process, schedule
   listing, self-report, or old GREEN result alone is insufficient.
9. Pause, stop, uninstall, rollback, and migration are explicit and attended where the provider only
   exposes UI management. No lifecycle hooks, LaunchAgent, hidden second consumer, heuristic thread
   discovery, or ordinary Codex config/auth mutation.

The 90-second SLO measures run creation while the lane is idle. Each discovery slice stops within 15
seconds and either finishes or persists drain progress. A simple informational disposition must commit
within 90 seconds after run start. A work slice is capped at 45 seconds; one message may use at most
ten slices or ten elapsed minutes before it records the terminal `REQUIRES_USER` disposition defined
in section 5. This is polling continuation, not event-driven transport parity with Claude Monitor.

## 3. Supported-surface decision

### Primary candidate: native scheduled task inside the existing chat

OpenAI's **Scheduled tasks** documentation, retrieved 2026-07-30, says an in-chat scheduled task
returns to that chat with its existing context, supports minute intervals, can use chat-available
skills/plugins, uses the chosen local project or worktree, and runs unattended with the default
sandbox. It also says Codex CLI and the IDE do not provide the Scheduled management interface; tasks
are created and managed through ChatGPT web/desktop and the **Scheduled** view. Documentation is not
a capability result. N0 must prove the exact installed behavior before code exists.

The candidate is a native in-chat **continuation heartbeat**:

- an attended ChatGPT/desktop procedure binds one task to `T` and `E` at a one-minute cadence;
- no-mail runs perform only bounded pointer/checkpoint/all-mail inbox reads and emit no user-visible
  content if the product supports suppression;
- mail runs load Kijito state, handle rows in ID order, continue only already-authorized work in a
  fenced slice, update memory as state changes, and commit completed dispositions;
- status describes scheduled polling honestly.

Official references (retrieved 2026-07-30):

- [Scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)

### Conditional alternative: registered App Server thread

App Server supports `thread/resume` plus `turn/start` for a client-owned recorded ID. It is forbidden
for desktop-chat continuation unless a no-code probe proves the desktop host supplies the exact
current chat ID through a supported interface, explicitly leases it, displays client turns in the
same chat, queues collisions without `turn/steer`, and revokes the lease on handoff. No transcript
scan, mtime guess, private protocol, newest-thread selection, or separate `CODEX_HOME` is permitted.
Failure rejects this alternative; it never authorizes a heuristic.

### Rejected

- dedicated background thread (disproved by 2630);
- lifecycle hooks (session failures and no supported chat ownership);
- bare shell tail (observes bytes but cannot invoke Codex);
- UI/accessibility scripting;
- newest/idle-thread guesses;
- inbox unread state as delivery state.

## 4. Provider-agnostic architecture and security boundary

The shared package owns persona binding, inbox discovery/pagination, exact-row fetch, checkpoint and
claim state, post-disposition courtesy read marking, idempotency/crash reconciliation, untrusted-data
fencing, pointer loading, health evidence, and provider-neutral test vectors. It does **not** invoke
an agent or manage a provider UI.

| Provider | Invocation primitive | Latency | Same-session proof |
|---|---|---:|---|
| Claude Code | persistent Monitor in owning process | event-driven | process/session plus Monitor identity |
| Codex desktop | native task inside armed chat | ≤90 s idle | rollout `session_meta.id`, native run/turn ID, and Scheduled record equal `T` |
| Codex App Server | only after supported explicit registration | candidate | registered lease and returned ID equal `T` |
| Unknown | none | none | INACTIVE, never ARMED |

Drivers expose actual semantics; no universal “wake” label hides polling.

This design intentionally moves untrusted mail into Jason's working chat, whose already-selected
workspace-write profile has more capability than the withdrawn notifier's read-only dedicated home.
The fixed prompt must place mail only inside tool-returned untrusted-data fences, pin persona/project/
tool allowlist before reading, forbid authority changes derived from mail, and require normal platform
approval/sandbox enforcement. G3 tests behavioral attempts to alter those values. N3 separately shows
Jason the residual prompt-injection and unattended-tool risk, exact effective permission profile, and
available mitigations; Jason must explicitly accept it. Silence is not approval.

## 5. Durable mailbox transaction

Unread is presentation metadata, not the ledger.

### Discovery

1. Read `CODEX_CONTINUATION_CHECKPOINT_V1` for persona `codex`.
2. Fetch newest inbox with `unread_only=false, mark_read=false`.
3. Page backward with `before_id` until the completed checkpoint or mailbox start. A new scan freezes
   its newest observed ID as `scan_upper_id`; later arrivals belong to the final repoll/next scan.
4. One tick stops at the earliest of 15 seconds, 256 inbox requests, 10,000 new unique IDs, or 32 MiB
   of decoded bodies. It atomically persists `scan_upper_id`, next `before_id`, verified ID/range
   segments, bytes, and start time as `DRAINING_BACKLOG`; it never looks empty or restarts from newest.
   `completed_id` remains unchanged. The next tick resumes that cursor. Once it reaches the
   checkpoint/mailbox start, it drains the verified pending IDs in ascending order across bounded
   ticks before beginning another scan.
5. Repoll newest after the backward walk so concurrent arrivals are not stranded.
6. Sort IDs above the completed checkpoint ascending and exact-refetch each with
   `before_id=<id+1>, limit=1, unread_only=false, mark_read=false`.
7. ID gaps are allowed only when every page's strict ordering and continuation metadata bridge them;
   the exact target still must be returned. Missing exact ID, truncated body, contradictory paging,
   missing provenance, corrupt persisted scan state, or unbridgeable gap is
   `BLOCKED_ROW(<id>)` and cannot advance the checkpoint.

This finds 2630 even though it is already read and remains correct when another consumer marks rows
read during the walk.

### Claim, work intent, disposition, acknowledgment

The current hosted `kijito_hive_claim` is an account claim with a 60-second default lease and no
plan-proven holder-bound renewal/fencing contract. A one-minute scheduled cadence
can therefore outlive and lawfully steal a predecessor's lease. It is not accepted as the continuation
transaction merely because two simultaneous callers produce one winner.

`CODEX_CONTINUATION_CHECKPOINT_V1` contains schema version, persona, armed task/chat ID, project/
worktree/environment identity, permission profile, prompt digest, last completed ID, scan upper ID/
cursor/verified ranges/pending IDs/byte count, optional active message ID/holder token/fence/lease
expiry/intent, disposition and slice count/deadline, ambiguity evidence, validated operator-decision
ID/digest, native run/turn ID, pointer ID/digest, last successful heartbeat, last acknowledgment, and
current health state/reason including the exact blocked message ID. This checkpoint namespace is
run-authored only: it contains observations of operator decisions, never operator-authored authority.
Unknown/missing fields fail closed; doctor compares these exact fields rather than an informal claim.

Operator authority lives only in a separate append-only
`CODEX_CONTINUATION_OPERATOR_DECISION_V1` journal that doctor and the scheduled run can read but the
scheduled run's principal, tools, sandbox, and workspace cannot create, append, replace, or delete.
No operator-authored checkpoint or control-plane field may be writable by a scheduled run. An
attended helper outside the scheduled environment signs a canonical envelope containing schema,
persona, `T`, message ID, observed input/failure digest, checkpoint digest, decision, reason, expiry,
and a verifier-generated nonce with an operator key unavailable to the run. Jason pins the signer key
in an attended journal arm record that the run also cannot modify. The journal authenticates the
attended writer and returns an immutable decision ID. Executor and doctor exact-fetch the journal row,
verify signature, signer, expiry, nonce, and every binding, then treat the checkpoint's ID/digest only
as a run-authored observation. Mail text, checkpoint contents, or a copied/replayed decision can never
substitute for that artifact. If the current surface cannot enforce the separate principals and
append-only journal, River's separately reviewed provider-neutral prerequisite must provide it before
N1; no local convention is an acceptable substitute.

N1 must either prove stronger existing surfaces or independently gate minimal provider-neutral
`CONTINUATION_CLAIM_V1` and operator-decision journal surfaces before any Codex implementation. The
claim surface must atomically return a unique holder token and monotonic fence, use a 180-second lease,
renew only for the same holder every
45 seconds, reject older fences after takeover, and permit at most one active claim for `(persona,
message_id)`. The work slice remains 45 seconds; a renewal failure stops before further action. A
claim becomes stale only after server time passes `lease_expires_at`; expiry permits a new discovery
owner but never proves a prior external side effect did not happen.

Jason owns the work envelope by writing it in the current request or current-state pointer before the
row arrives; mail cannot create or widen it. Before any mutation, the holder atomically writes an
intent containing message ID, fence, native run ID, action kind/target, input digest, idempotency key,
expected pre-state digest, and reconciliation method. The mutation must either accept that
idempotency/fence or produce independently readable before/after evidence. If neither is possible,
the run takes the `REQUIRES_USER` terminal path below
and does not perform it.

After action, the holder records the provider receipt/output digest, exact-refetches `M`, and commits
`completed_id=M` plus disposition in the same fenced checkpoint transition. That commit is the ack.
It then releases/clears the exact claim and only afterward may exact-refetch with `mark_read=true` as
a courtesy. Release failure enters `CLAIM_RELEASE_FAILED(M)` under the rules below. A crash reconciles
intent against the external receipt/state; it never retries solely because the lease expired. If the
45-second work slice ends before disposition, the holder atomically records `DEFERRED` progress and
reconciliation state, releases its lease, and leaves `completed_id` unchanged. No action occurs after
release.

`REQUIRES_USER(M)` is a fenced terminal disposition, not a retry state. Whether caused by an unsafe
adapter or the ten-slice/ten-minute bound, it records reason, progress, intent/receipt evidence, and
available operator choices; atomically commits `completed_id=M`; then releases the exact claim. It blocks all
later automatic work and ARMED health without rediscovering or re-executing `M`. An attended operator
escapes it only with one valid out-of-band operator-decision journal row: accept/decline the
disposition, attest repaired external state, or narrow/extend the pre-registered envelope and resend
as a new higher-ID row. Clearing the health block requires that exact artifact and never reopens `M`.

`AMBIGUOUS_ACTION(M)` means crash reconciliation cannot prove whether the recorded intent produced an
external effect. It records the contradictory/missing evidence, leaves `completed_id` below `M`,
releases the exact claim, and blocks discovery, later work, and ARMED health without attempting the
effect again. An attended operator must supply independently readable evidence that lets the fenced
checkpoint, under a fresh higher holder/fence for `M`, either commit `M` once or exact-quarantine `M`
with a valid exact-bound operator-decision artifact; only then may the block clear. Quarantine and
`REQUIRES_USER` release their exact claim after their fenced commit.

Any release failure enters `CLAIM_RELEASE_FAILED(M)`. It preserves the already-chosen
`completed_id` effect, performs only idempotent release/server-absence checks, and remains doctor-RED.
It clears automatically only when server time proves the lease expired or the exact holder is absent;
an attended operator may exact-release the verified holder. Neither recovery repeats disposition or
external action. Clearing this release substate restores any underlying `REQUIRES_USER`, ambiguity,
or deferred/committed checkpoint state and forces doctor to re-evaluate every ARMED requirement.

## 6. Health and attended lifecycle

There is no assumed programmatic Scheduled management API.

- **Arm:** Jason or an attended operator creates/enables the in-chat task through ChatGPT/desktop,
  selects `T`, local project/worktree, model, cadence, and permission profile, then records the native
  task/run evidence discovered by N0. Re-arm for the same identity is a documented idempotent UI
  procedure; another chat requires cutover first.
- **Doctor:** a read-only verifier outside the scheduled run reads the recorded rollout/run artifact,
  checkpoint/claim state, operator-decision journal, and hosted heartbeat. For a one-minute cadence,
  “recent” means server age at most 135 seconds (two cadences plus 15 seconds measured skew); excess
  skew is RED. It reports ARMED only while successful native runs continue within two cadences and
  every identity field matches. It reports `DRAINING_BACKLOG`,
  `BLOCKED_ROW(id)`, `REQUIRES_USER(id)`, `AMBIGUOUS_ACTION(id)`, `CLAIM_RELEASE_FAILED(id)`,
  `LEGACY_CONSUMER`, `STALE`, or `INACTIVE` explicitly.
  It never claims that a UI task exists/enabled from self-report alone.
- **Blocked-row escape:** automatic skipping is forbidden. An attended operator may repair/resend the
  row or exact-quarantine one ID with reason and a valid exact-bound operator-decision artifact.
  Quarantine writes a durable tombstone/disposition, preserves body digest/provenance where available,
  advances only that exact ID under the claim fence, and releases the exact claim. The validated
  journal decision is the recovery confirmation; successful commit/release clears that exact block.
  Release failure follows the path above.
- **Pause/uninstall:** the attended operator disables or deletes the exact task in **Scheduled** and
  verifies no run for two cadences. Uninstall then removes only manifest-owned checkpoint artifacts
  after identity/ownership verification. No hooks, LaunchAgents, ordinary auth/config edits, or UI
  scripting are used.

N0b must probe the complete attended create, inspect, pause, resume, and delete path plus quotas,
expiry, cadence limits, locked/background behavior, and recent-run evidence. If the installed product
cannot expose enough evidence for doctor, the candidate is RED rather than papered over by a command.
If the Scheduled record is UI-only, its attended capture is setup evidence; mechanized doctor uses
the immutable rollout plus hosted heartbeat and lets ARMED expire within two missed cadences. It does
not pretend to read an unsupported management API.

## 7. Legacy cutover ownership and rollback

ARMED is unreachable while PID 38082 or any legacy notifier can consume persona `codex`. Planning and
N0-N3 do not touch it.

After two Assay-CLEAN plan reviews, N0-N3, implementation gates, and Jason's explicit authorization,
River owns the attended cutover:

1. Pause the new native task and snapshot its empty/non-disposition state.
2. Stop the legacy controller; freeze and verify its last durable row/checkpoint and consumer lock.
3. Prove for two old poll windows that no legacy or second consumer can advance the stream.
4. Import/reconcile the checkpoint under the new fenced schema, verify exact IDs/digests, then enable
   the native task and run one isolated canary.
5. On failure before a native disposition, disable the native task, remove its uncommitted claim, and
   restart the legacy process from the verified snapshot. After any native intent/disposition,
   automatic rollback is forbidden; River reconciles the exact row/action before choosing one owner.

The rollback never runs two consumers concurrently and never treats `mark_read` as the cursor.

## 8. Pre-implementation gates

**AUTHORITY:** Two consecutive Assay-CLEAN reviews of this exact plan digest open N0a/N0b only.
GREEN N0 then authorizes disposable test-persona probes of the current N1-N3 surfaces, but no
Codex-provider or Kijito-server implementation. If N1 rejects the current API, a separate
provider-neutral claim/operator-decision API plan owned by River must receive two consecutive
Assay-CLEAN reviews before any such API code is written. An installable Codex provider remains
forbidden until N0-N3 are GREEN and Jason explicitly accepts N3.

Disposable probes use a dedicated test persona, never persona `codex`, except N0a's explicitly
read-only `mark_read=false` capability peek.

### N0a — native same-chat, collision, and unattended capability

Before task creation, the outside verifier snapshots the app-owned rollout set, generates a 128-bit
nonce, and Jason submits that nonce in one attended marker turn in the target chat. Exactly one rollout
created/advanced after the snapshot must contain that marker turn and a first
`session_meta.payload.id`; that ID becomes pinned `T`. Zero/multiple matches, run-generated nonce,
newest/mtime selection, or visual/transcript similarity is RED. Marker evidence acquires `T` only and
never proves a background run's identity.

With a disposable schedule and no Kijito controller code, record `T` and `E`; create a one-minute
task inside `T` that returns a second verifier-generated 128-bit nonce pre-registered with task ID and
prompt digest before scheduling, and performs a read-only proof of `E`. An independent
verifier outside the run must read the app-owned rollout plus Scheduled run record and match `T`,
turn/run ID, nonce, cwd/project/worktree, model, sandbox, approval and permission profile. Repeat:

- after a completed manual turn;
- while a manual turn is still active, proving the scheduled input queues and never uses steering;
- with two disposable in-chat tasks synchronized to one minute boundary while the first waits on a
  disposable 75-second barrier, forcing overlap and proving only one run acts while the other records
  a collision without steering or disposition; this synthetic overlap probe is exempt from the
  45-second production work-slice cap;
- while the app is backgrounded and Jason has been inactive for ten minutes;
- once while the screen is locked, with computer awake and app running.

In a second disposable run, invoke installed `kijito-start` far enough to reach hosted Kijito, read the
current pointer ID, and perform a `mark_read=false` inbox peek. Prove the scheduled run has the exact
skill/plugin/MCP availability required. Manual prompting, a lookalike chat, self-reported identity,
wrong environment/profile, steering, unavailable tools, a different brain, unread mutation, hidden
API, or UI automation is RED.

### N0b — attended task-management and health evidence

Through documented ChatGPT/desktop controls, create, inspect, pause, resume, and delete the disposable
task. Independently capture which stable IDs/run records/rollout artifacts are readable, cadence and
quota/rate/expiry limits, and what happens after app exit, sleep, lock, project removal, and permission
change. Measure server/host clock skew and require it not exceed 15 seconds. Prove doctor derives its
state only from those artifacts plus hosted heartbeat and turns RED within two cadences after
pause/delete/drift. If management requires unsupported automation or doctor
cannot distinguish enabled from stale/disabled, N0b is RED.

### N1 — fenced checkpoint transaction

Test the exact chosen API, not a mock. This synthetic lease-duration probe is exempt from the 45-second
production work-slice limit. Two concurrent claimers yield one holder token/fence. Keep one
holder alive past 60 seconds and two schedule cadences; a contender cannot steal it. Stop renewal and
prove takeover only after the 180-second server deadline with a larger fence. The old holder then
cannot write intent, renew, commit, or acknowledge. Crash before intent, after intent, after external
effect, and after commit; each reconciles without duplicate side effect. A non-idempotent adapter
without intent+receipt reconciliation is refused. If this requires either new surface, its API,
threat model, tests, and independent review are a separate provider-neutral prerequisite.
Force both causes of `REQUIRES_USER`, an irresolvable receipt into `AMBIGUOUS_ACTION`, and release
failure after success/terminal/quarantine commits. Assert each state's checkpoint and `completed_id`
effect, doctor/ARMED block, no-repeat behavior, and automatic or attended escape.
Attempt scheduled-run writes to every operator journal/control-plane field and require structural
denial. Inject forged, copied, expired, replayed, wrong-chat/message/body/checkpoint, and valid
operator-decision artifacts; only the exact live journal row may authorize one escape.

### N2 — exact durable-row retrieval and blocked recovery

Synthetic account-owned mail proves unread, already-read, older-window, ID-gap, and content-budget
rows are found; another consumer marks rows read during every paging phase; arrival during paging is
caught by final repoll; exact fetch returns the intended ID; oversized/truncated/missing/provenance-bad
content blocks discovery and makes doctor RED; no later row advances. Corrupt derived scan state
blocks at `completed_id+1`; a valid operator-decision artifact may discard only scan cursor/ranges/
pending/byte fields and force a full newest-to-completed rescan while leaving `completed_id`
unchanged. Repair and operator-quarantine each recover only the exact blocked ID; checkpoint ack and courtesy `mark_read` affect only the intended
row. Exercise the 15-second/request/ID/byte bounds, require persisted `DRAINING_BACKLOG`, resume from
the saved cursor across ticks, and drain the entire backlog once without false empty or duplicate work.

### N3 — measured cost, compaction, interference, and risk acceptance

Run 30 idle minutes and 30 active-mail minutes in the disposable workspace, followed by one forced
native compaction and a six-hour unattended soak. Record run count, exposed tokens/rate-limit change,
wall time, failures, completed-disposition latency, manual-turn collisions, visible no-mail artifacts,
rollout/transcript byte growth, context-window growth, compaction behavior, and locked/background runs.

Default RED thresholds, fixed before measurement: any wrong-chat/steered/overlapping disposition;
any no-mail user-visible message; more than 2 KiB rollout growth per idle run; more than 5% context
growth in 30 idle minutes; more than 30,000 exposed tokens in 30 idle minutes; any missed idle run
beyond 90 seconds while computer/app are available; any simple disposition beyond 90 seconds after
run start; any compaction that loses pointer/claim state; or any permission/tool drift. A threshold
may change only in a new plan digest before the run, never after seeing results.

Jason receives the measured daily projection, visible-noise/context cost, exact permission profile,
prompt-injection residual risk, polling semantics, and mitigations. The disclosure states that any
single inbound row can terminally halt the lane—through invalid/provenance-bad content or the work
bound—until Jason supplies an out-of-band attended decision. These bounds are not runtime-adjustable;
changing them requires a new reviewed plan digest before measurement. He must explicitly accept all
of this before implementation. Silence is not approval.

## 9. Future implementation gates

These specify QA; they are not implementation permission.

- **G1 protocol:** property tests for paging/bounds, exact fetch, fenced lease renewal/takeover, stale
  writer rejection, intent/effect/commit crash reconciliation, operator-journal signature/replay/write
  partition, ordering, duplicates, hostile content, bad provenance, clock skew, blocked health, and
  migration fence. Each high-value property has a
  mutation failing at its unique named assertion.
- **G2 same chat:** no-mail read-only; normal/already-read mail handled once in `T`; native rollout
  identity independently verified; manual-turn input queues without steer; overlaps suppress; sleep/
  restart drains backlog; compaction reloads pointer; no authorized work yields explicit disposition.
- **G3 security:** injection, role impersonation, exfiltration, scope expansion, destructive requests,
  sender spoofing, oversized text, and malformed Unicode/JSON cannot change prompt/instruction role,
  tool allowlist, sandbox, project, chat target, claim fence, intent, operator-decision ID/digest, or
  ack order. No operator-authored checkpoint/control-plane field is writable by the scheduled run;
  this write partition is a property test over the schema, not a field enumeration.
- **G4 lifecycle:** attended idempotent arm, wrong-chat refusal, pause/resume, ownership-bound uninstall,
  app-down/disabled/outage/blocked health, stale-claim recovery, cutover/rollback, hard double-consumer
  fence, and zero hooks/LaunchAgents.
- **G5 live golden:** A performs the registered disposable file/test mutation in exact `T`; B repeats
  after app restart or sleep/wake; C repeats after forced compaction; disabled schedule leaves D
  durable and health not ARMED, then re-enable handles D once. Each has independently matched native
  run identity, external receipt, exact disposition, fenced checkpoint ack, and SLO. Summary-only is
  RED.

## 10. Plan QA and independent gate

Author preflight is presence-only lint and never counts toward the two-review bar. On one digest it
must:

1. trace every outcome clause and every accumulated independent load-bearing finding to a named N/G
   assertion;
2. require named rejection text for dedicated/lookalike thread, self-reported identity, manual prompt,
   chat-only “work,” unread-only lookup, expired lease, stale writer, poison row under ARMED, second
   consumer, hostile authority text, disabled task, and summary-only turn;
3. emit unique lint markers. It constructs no specimen and is not semantic review evidence.

For every runtime state or production execution bound added by a revision, the author lint record must
explicitly trace five properties: doctor enumeration, outcome 8 ARMED effect, checkpoint fields, a
named N/G probe, and the `completed_id` effect plus automatic/attended escape. Missing any one is RED
before freeze.

After preflight, commit/push the plan-and-supersession-fence branch and send Assay the exact returned
commit SHA plus plan digest. A load-bearing finding changes the digest and resets the Assay count. The
AUTHORITY statement in the status and section 8 is the complete post-review boundary.

## 11. Non-goals and exit

No use of the withdrawn controller's upgrade/migration path; section 7 alone governs checkpoint
cutover. No instant/event-driven claim for polling; no universal transport;
no autonomy outside an explicitly armed chat and existing authority; no mail-as-command authority;
no merge/publish/production change during plan approval.

Planning ends when this document passes author preflight, its gate artifact is committed, the branch
is pushed, Assay records two consecutive CLEAN reviews on the exact digest, memory points to the
verdict/next gate, and production remains untouched.

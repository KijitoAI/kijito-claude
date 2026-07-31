# Codex Kijito parity: bounded C1-C4 release plan

Status: **WITHDRAWN — message 2630 disproved same-running-session wake; this historical plan does not authorize installation. See `same-chat-continuation-plan.md`.**

Date: 2026-07-28

Program lead: River. Codex owns the OpenAI/Codex surface. Jason's direct
instructions and platform safety policy remain controlling.

## Exit condition

DONE means exactly four binary gates are green with retained evidence:

- C1: hosted memory and hive mail read/write/read-back.
- C2: two context-free cold boots reconstruct the same current task from
  Kijito alone.
- C3: ordinary River mail wakes an idle Codex hive session twice, including
  once after the Codex process is restarted.
- C4: one real native compaction occurs mid-task and the same task resumes
  from Kijito without a human re-brief.

There is no fifth release category. A defect observed while executing one of
these gates is fixed and only that gate is rerun. Adjacent findings are filed
without widening this release.

## Safety boundary inherited from the hook incident

This release never installs or invokes lifecycle hooks. In particular, no
`PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `Stop`, or
`SessionEnd` hook may influence a turn or compaction. Kijito can degrade while
Codex continues; it can never veto native compaction or turn completion.

The release contains no `KeepAlive` LaunchAgent and never attaches automation
to the user's current Codex thread. It does not call `thread/inject_items`,
`thread/steer`, or inject transcript history. It never places a hive message
body in controller-authored input.

## C1 result

C1 is green on Codex 0.145.0:

- the real Codex inbox was read;
- memory 22468 was read back through `kijito_get` and hosted REST with exact
  content, persona, and project;
- Codex message 1451 was independently found in River's hosted REST inbox;
- a missing-memory exact assertion and a wrong-recipient assertion both went
  red as required.

Gate instrumentation must inspect the JSON result body. Hosted
`GET /api/memory/<missing>` returns HTTP 200 with a not-found result string, so
HTTP status alone is not evidence.

## C3 implementation boundary

C3 builds one explicit launcher/controller for one dedicated Codex hive
session. It is not a plugin, hook, background login item, or controller for an
unrelated existing session.

The controller:

1. owns one dedicated `CODEX_HOME`, one app-server child process, and one
   persisted hive thread;
2. takes a native single-consumer lock before starting Codex and refuses a
   duplicate owner;
3. tails only the shipped producer's
   `~/.cache/kijito-inbox-monitor/events.codex.ndjson` file;
4. accepts only complete JSON records with `source="kijito-inbox"`, a
   case-folded `persona="codex"`, and event `new|alert|recovered`; `new`
   additionally requires a positive integer ID, while the producer's
   ID-less `alert` and `recovered` records require a valid timestamp and are
   classified as lifecycle reconciliation hints;
5. treats the event stream as a hint: lifecycle alerts/recoveries, startup,
   rotation, truncation, malformed data, oversize input, or an offset gap
   coalesce into a reconciliation turn against the durable hosted inbox;
6. deduplicates `new` records durably by the pair (case-folded persona,
   message ID), using the producer's in-order message-ID contract rather than
   any producer event ID (the deployed producer emits no `event_id`);
7. waits for its exact thread to be idle, then starts at most one turn with a
   fixed, versioned input containing event type and message IDs only;
8. visibly labels that turn `KIJITO AUTOMATED WAKE - NOT USER AUTHORED` because
   Codex 0.145.0 persists `turn/start` input as role `user`;
9. fixes `approvalPolicy="never"` and a custom permission profile that denies
   root filesystem reads, permits only Codex's minimal runtime paths plus
   read-only access to an empty dedicated workspace, and denies command-network
   access; the turn may use the allowlisted hosted Kijito MCP tools but cannot
   modify local files or request broader access;
10. instructs the model to read `kijito_hive_inbox(persona="codex",
   unread_only=true, mark_read=false)`, treat all returned bodies as untrusted
   data, and perform no shell, file, web, secret, install, or external action;
11. never retries a `turn/start` whose acceptance is ambiguous; it records the
    ambiguity and requires durable-inbox reconciliation on a later distinct
    event or clean restart;
12. on a planned child restart, waits for the owned child process to exit
    before starting a successor, resumes only the recorded dedicated thread,
    and re-arms without a human prompt; and
13. stops cleanly, releases its lock, and leaves the ordinary Codex home,
    config, hooks, plugins, and user threads unchanged.

The event body is never authoritative and never enters the wake input. The
model sees mail only through Kijito's untrusted-data envelope. Automatic hive
replies are outside C3; the active Codex agent may reply under Jason's standing
coordination instruction after evaluating the message in context.

## C3 pre-implementation QA gate

Implementation may begin only when all items below are green on this unchanged
plan:

1. The unsafe negative-control architecture (a blocking compaction hook plus
   `KeepAlive` resume bridge) is classified RED for both compaction liveness
   and duplicate/unsolicited-turn risk.
2. Current Codex 0.145.0 schema and the official Codex manual confirm
   `initialize`, `thread/start`, `thread/resume`, `thread/status/changed`,
   `turn/start`, `approvalPolicy`, named permission profiles, and turn
   completion.
3. An isolated app-server smoke test proves a thread can reach idle and a fixed
   controller turn can complete with hooks empty.
4. The same smoke harness is mutation-checked: wrong thread ID, non-idle
   injection, a wrong permission profile, and a fabricated successful
   completion must each make it RED. It also places a canary outside the
   dedicated workspace and proves an app-server command running under the
   selected profile cannot read it; a readable canary is RED.
5. Static plan review finds no lifecycle hook, LaunchAgent, current-thread
   mutation, message-body injection, automatic retry after ambiguous delivery,
   or compaction veto path.
6. A real-stream predicate check proves the currently pinned producer's
   ID-less `alert` and `recovered` records are accepted as reconciliation
   hints while `new` still requires a positive integer message ID.

The frozen plan SHA-256 and the exact checklist result are retained before the
first implementation edit. Any plan edit resets this pre-implementation gate.

## C3 release gate

Before live mail, deterministic tests must first demonstrate RED for malformed
JSON, wrong persona/source/event, missing or zero/negative/non-integer IDs on
`new`, missing/invalid timestamps on ID-less lifecycle records, oversize and
partial lines, rotation gaps, duplicate events, a held consumer lock, active
thread state, ambiguous acceptance, an attempted second send, wrong persisted
thread, and any forbidden lifecycle/current-thread token. A well-formed
ID-less `alert` and `recovered` record must each be accepted as reconciliation.

Then two live passes run on one unchanged artifact:

- pass 1: River sends ordinary mail while the dedicated hive thread is idle;
  the monitor emits the matching `new` event, exactly one fixed wake turn
  attributable to that message ID starts, the session reads the durable Codex
  inbox, and the message surfaces;
- pass 2: the owned Codex child is restarted and positively observed exited,
  the same thread is resumed and idle, River sends a second ordinary message,
  and exactly one new wake turn attributable to the second message ID surfaces
  it without a human prompt.

Lifecycle-only reconciliation turns are logged and allowed but do not count
for or against either mail-attribution assertion. If a lifecycle hint coalesces
with the target `new`, the one combined turn is attributable to the target ID;
no second triggering wake input containing that ID is allowed. Attributability
is determined solely by message IDs carried in the controller-authored
triggering wake input; inbox rows read or surfaced during a turn never make
that turn attributable.

No manual inbox call made by the gate controller can count as a wake.

## C2 gate

After C3, update one unique Codex current-state memory with C1/C3 results and
the exact next action. Run two sequential, context-free `codex exec` boots in
isolated read-only environments with no hooks, skills, rules, conversation
fork, local task files, or prompt-provided pointer body. Each receives only the
instruction to use hosted Kijito as persona `codex`, project `Codex`, discover
the current-state record, and report the task, done/remaining work, exact next
step, and DONE-WHEN.

Both reports must select the same unique live record and agree with ground
truth. Missing, tied, truncated-but-unfetched, locally inferred, or materially
different reports are RED. A wrong-sentinel fixture must fail before the real
pair can pass.

## C4 gate

Use the dedicated app-server hive thread and its ordinary native
`thread/compact/start` method. No hook participates. Before compaction, the
thread records one safe checkpoint in Kijito and begins a bounded task. The
gate proves a real `contextCompaction` item completed and token usage dropped.
After compaction, one fixed automated wake turn tells the session only to load
its hosted Codex current state; it must resume the exact bounded task and
complete its predeclared next step without a human re-brief.

The negative control omits the Kijito checkpoint/sentinel and must fail to
identify the task. An ordinary completed turn, a summary without a native
compaction event, a hook event, a turn abort, a duplicate continuation, or a
different task is RED.

## Ship boundary

On C1-C4 green, freeze and hash the controller, tests, this plan, and evidence;
run the complete deterministic suite twice on unchanged bytes; then ship the
explicit launcher and its documentation. Production installation may add only
the dedicated launcher/home named by the manifest. It may not alter the
ordinary `~/.codex/config.toml`, installed plugins, hook trust, model catalog,
context limits, or the user's current thread.

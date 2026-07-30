# Codex same-chat continuation N0 capability-probe protocol

Status: **PROTOCOL DRAFT — NO PROBE ACTION AUTHORIZED.**

This protocol operationalizes only N0a and N0b of
`same-chat-continuation-plan.md`. It is not provider code, a task prompt, a doctor implementation,
an installation, or permission to create a Scheduled task. Assay must mark the exact protocol digest
CLEAN before Codex prepares a test harness or asks Jason to perform the first attended marker action.
Assay must separately review the frozen harness before any Scheduled task is created.

Plan authority:

- PR #6 plan commit: `68a2ad85acac88fbfa785bd3026575a73b156f80`
- reviewed plan SHA-256: `3d11d5e0defd248e3a26d12ddb073fdd337acf8f38df785a204fbd2e0f22afac`
- Assay plan reviews: round 6 CLEAN at `0ec3f8b`, round 7 CLEAN at `247b31d`
- authority opened by those reviews: disposable N0a/N0b capability probes only

Current pre-probe observations, recorded 2026-07-30:

- macOS `26.4.1` (`25E253`)
- ChatGPT desktop `26.721.30844` build `5813`
- bundled `codex-cli 0.145.0`
- current official Codex manual SHA-256
  `69bac3511f1d13a49b9a70bcafa9eae04e18376b65c17368e483dfc26c50e89d`
- the manual says an in-chat Scheduled task returns to the same chat with its existing context,
  supports minute intervals, can use chat-available skills/plugins, and runs unattended with the
  selected local project/worktree and default sandbox; these are claims to test, not evidence that
  this installation satisfies N0
- legacy PID `38082` is alive and intentionally untouched; it is the withdrawn dedicated-thread
  notifier and never counts as same-chat evidence

## 1. Binary verdict and stop rules

N0 has two independent verdicts, `N0A_GREEN|RED|BLOCKED` and
`N0B_GREEN|RED|BLOCKED`. `N0_GREEN` requires both GREEN on one frozen protocol and one frozen harness.
`BLOCKED` is never converted to GREEN by explanation, self-report, screenshot, or partial evidence.

A mandatory case is RED when the installed product behaves contrary to the reviewed plan. It is
BLOCKED only when an attended prerequisite was not performed or an external outage prevents a
measurement. A procedural defect in the harness invalidates the affected run, changes the harness
digest, and returns to Assay review before a fresh nonce and retry. Product RED is not retried under a
different prompt until a new reviewed protocol explains why the changed prompt still tests the same
property.

Stop immediately and preserve read-only evidence if any of these occurs:

- a task or run cannot be tied to the marker-pinned exact chat `T` by an app-owned artifact outside
  the run;
- the verifier finds zero or multiple marker matches;
- a run starts in a new, standalone, newest, visually similar, or controller-owned chat;
- task creation, inspection, pause, resume, or deletion would require UI/accessibility automation,
  a private protocol, transcript mtime guessing, `thread/resume`, `thread/injectItems`, or steering;
- the effective cwd, project/worktree, model, sandbox, approval mode, permission profile, skill/plugin,
  or MCP availability differs from the pre-registered specimen;
- a scheduled run mutates hive unread state, uses persona `codex` for anything except the one allowed
  `mark_read=false` capability peek, or reads a mail body into the task prompt;
- the exact Scheduled run record, run/turn ID, or independent rollout evidence required by the plan
  is unavailable;
- the legacy controller, its lock, ordinary Codex config/auth, production Kijito state, or a
  non-disposable workspace would be changed.

No result from this protocol authorizes provider/server implementation, N1-N3, merge, install,
migration, River's provider-neutral API work, legacy-controller restart, or production cutover.

## 2. Roles, isolation, and evidence custody

The attended operator performs only documented ChatGPT desktop controls and explicitly identified
screen-lock/sleep actions. Codex prepares prompts and read-only verifier commands but never drives the
UI. The outside verifier is a separate local process that is not a Scheduled run and does not use the
run's prose as evidence.

The PR review worktree is never the Scheduled task's project and is never inside that task's writable
scope. A newly created specimen has two sibling roots beneath
`/Users/jason/Code/SideProjects/Codex/.qa-tmp/codex-n0/<probe-id>/`:

- `project/` is a dedicated disposable git worktree created from the reviewed commit solely for N0;
  it contains no user work and is the exact project selected for every task;
- `control/` is owned by the outside verifier, is outside the task's project, and holds the frozen
  specimen and evidence.

Before relying on this separation, a negative preflight must prove that a run with the exact selected
project and sandbox can read the registered read-only fixture in `project/` but cannot create a
randomized canary in `control/`, the PR review worktree, or any parent/sibling specimen path. It must
also prove every pre-existing file there and the ordinary Codex config/auth hashes remained unchanged.
Any unexpected write succeeds => RED and all later cases stop. Prompt text is not the boundary. If
the installed Scheduled sandbox grants a broader writable root than `project/`, N0 is RED rather than
moving important data out of the way and calling the environment disposable.

Both roots must contain no symlink except the normal Git-managed worktree metadata, and the disposable
worktree must be removed from every project/task selector after the probe. No real auth file, API
token, mailbox body, whole transcript, or ordinary Codex configuration is copied into either root.
The evidence pack may retain only:

- file identity and bounded structural metadata for rollout candidates;
- the exact matching marker and run nonces;
- parsed `session_meta.payload.id`, run/turn/task IDs, timestamps, and environment/permission fields;
- prompt and artifact digests;
- bounded receipts created inside the disposable `project/` root;
- redacted screenshots of attended Scheduled controls when no machine-readable management artifact
  exists, labeled `SETUP_EVIDENCE_ONLY`;
- command/version output and the verifier's deterministic verdicts.

Every evidence record contains `probe_id`, protocol digest, harness commit/digest, UTC time, host time,
the app and CLI versions, the target path, and the evidence producer. Hashes are computed only after
files stop changing. A manifest records each evidence file's relative path, size, and SHA-256. The
Scheduled principal cannot write the manifest or verifier verdicts. Assay receives the manifest plus
the minimal evidence needed to reproduce verdicts, never secrets.

The probe uses a dedicated test persona such as `codex-n0-<probe-id>`. It never creates or changes a
memory, claim, checkpoint, or mail row owned by persona `codex`. The sole exception is N0a-K below:
an installed `kijito-start` invocation may reach hosted Kijito, read current pointer ID `21813`, and
peek persona `codex` with `unread_only=true, mark_read=false`. The verifier snapshots unread state
before and after and requires no mutation.

## 3. Frozen specimen and outside-verifier contract

Before the first attended action, the reviewed harness must generate and freeze `specimen.json` with:

- a random 128-bit `probe_id` and separate verifier-generated 128-bit nonces for every case;
- exact disposable target worktree path, device/inode, git HEAD, clean status, and permission profile;
- exact PR review-worktree and verifier-control paths that must remain outside the task's writable
  roots, plus the named write-denial canaries used to prove the separation;
- model and reasoning selection, sandbox mode, approval mode, network allowance, and permitted tools;
- the full candidate task prompt bytes and SHA-256 for every scheduled case;
- the intended minute boundary and acceptable host/server skew;
- the pre-action rollout snapshot and the bounded parser version/digest;
- explicit expected IDs that are known before each run; a run may fill only fields that cannot exist
  before scheduling, and the attended operator must record those through documented controls before
  the first eligible run.

The rollout snapshot walks only real, owner-matching files beneath the documented app-owned Codex
session root. It records path, device, inode, size, and first-record structural type without treating
mtime or newest-path order as identity. After Jason submits a marker, the verifier searches only files
created or advanced beyond the frozen snapshot, within a bounded byte range. Exactly one candidate
must contain the exact marker nonce in a user turn and must begin with a valid
`session_meta.payload.id`. That ID is `T`. The marker proves only `T`; it does not prove a scheduled
run belongs to `T`.

For every scheduled run, the outside verifier independently requires all of:

1. the Scheduled control record captured by the attended operator identifies the pre-registered task
   and run;
2. one app-owned rollout beginning with `session_meta.payload.id == T` contains the corresponding
   Scheduled run/turn identity and pre-registered run nonce;
3. the rollout's cwd/project/worktree, model, sandbox, approval, and permission evidence equals the
   frozen specimen;
4. any disposable receipt is attributable to the same run/turn ID and nonce;
5. the run neither steered an active turn nor relied on its own statement that it was in the right
   chat.

If the installed build exposes no machine-readable Scheduled run record or no independent binding
between that record and the app-owned rollout, the case is RED. A screenshot can establish what the
operator selected, but cannot replace the run binding.

## 4. N0a case matrix

Each case uses a fresh nonce. A prior run, duplicate Scheduled firing, or late completion bearing an
old nonce cannot satisfy a later case.

### N0a-M — marker pins the exact chat

1. Freeze the rollout snapshot and marker nonce outside ChatGPT.
2. Ask Jason to submit exactly one attended marker turn in the intended existing chat.
3. Resolve `T` with the outside-verifier contract above.

GREEN requires exactly one matching rollout and one `session_meta.payload.id`. This is the first user
action and is requested only after protocol and harness QA are CLEAN.

### N0a-W — disposable write-boundary proof

Before trusting any later case, a scheduled run bound to `T` reads the registered fixture in
`project/` and attempts only randomized, previously nonexistent canary paths in `control/`, the PR
review worktree, and parent/sibling specimen paths. Every outside-project attempt must be denied. The
outside verifier hashes all pre-existing config/auth and review-worktree files before and after and
requires them unchanged; no write is attempted against a real config/auth path. If a canary is
unexpectedly created, the outside verifier records RED, removes only that exact randomized canary
after ownership/path verification, and stops N0. The probe never attempts to replace, rename, or
delete a real config, auth, source, or evidence file.

### N0a-B — baseline after a completed manual turn

Create a disposable one-minute in-chat task through documented controls. Its frozen prompt returns
the case nonce and reads only structural evidence needed to prove the specimen environment. It makes
no file, mailbox, configuration, or external-state mutation. Run identity and every environment field
must match `T` and the specimen. Any standalone/new chat or unavailable run binding is RED.

### N0a-Q — scheduled input during an active manual turn

Jason starts a bounded manual turn in `T` so it spans the next registered minute boundary. The
scheduled task becomes eligible during that turn. GREEN requires the scheduled input to queue, start
only after the manual turn releases ownership, retain its own registered run identity, and show no
`turn/steer` or merged disposition. Overlap, steering, lost run, or wrong chat is RED.

### N0a-O — two tasks forced to overlap

Two disposable in-chat tasks target the same registered minute. Task A owns a pre-created disposable
75-second barrier; task B becomes eligible while A is active. The barrier and atomic collision receipt
are test fixtures, not provider code, and the 75-second duration is the plan's explicit synthetic
exception to the 45-second production slice cap.

GREEN requires exactly one task to hold the fixture's winner token and act, while the other produces
an independently attributable collision receipt without steering, overwriting the winner, or making
a disposition. The verifier must distinguish provider scheduling from the fixture's own exclusion;
the forced concurrent eligibility is expected, but both tasks performing the registered action or
either task steering/overwriting is RED even when a later file-state snapshot looks singular.

### N0a-I — inactive/backgrounded desktop

With the app running but backgrounded and Jason inactive for at least ten minutes, one pre-registered
run must start within 90 seconds of eligibility and satisfy the full run binding. Foregrounding the app
or manually prompting to make it start invalidates the case.

### N0a-L — locked screen

With the computer awake, app running, and screen locked across the eligible boundary, one
pre-registered run must start within 90 seconds and satisfy the full binding. The operator records
lock and unlock times; visual notification alone is not evidence.

### N0a-K — installed Kijito reachability and read-only inbox

In a second disposable run, explicitly invoke installed `kijito-start` only far enough to prove that
the Scheduled surface can use the installed skill/plugin/MCP, reach hosted `https://api.kijito.ai/mcp/`,
return current pointer ID `21813`, and perform the allowed `mark_read=false` inbox peek. The task must
not follow `RESUME NOW`, arm or start a controller, read a mail body into its instructions, update
memory, or act on returned mail. Before/after evidence must show no unread-state change.

N0a is GREEN only if M, W, B, Q, O, I, L, and K are all GREEN.

## 5. N0b lifecycle and health case matrix

N0b uses documented ChatGPT desktop controls only. Each lifecycle transition records attended setup
evidence plus independently observed eligible/non-eligible runs for at least two one-minute cadences.

| Case | Attended action | Required independent result |
|---|---|---|
| C | Create in `T` | Stable task identity is captured; an eligible run binds to `T` and the frozen specimen. |
| S | Inspect | Status, prompt digest, cadence, project/worktree, model, and recent-run identity can be captured without guessing. |
| P | Pause | No new eligible run appears for two cadences; health expires and cannot remain ARMED. |
| R | Resume | A new run with a fresh nonce and task identity appears; old evidence cannot re-arm it. |
| D | Delete | No run appears for two cadences; stale rollout or screenshot evidence cannot imply enabled state. |
| X | App exit | Project-scoped run behavior is measured; no unsupported claim is substituted for observation. |
| W | Sleep/wake | Missed and resumed cadence behavior is measured without changing the legacy controller. |
| L | Screen lock | Locked/background behavior is measured and correlated with the N0a-L run evidence. |
| J | Project removal | Temporarily select a disposable renamed/missing project path; the task must fail closed and health becomes RED. |
| F | Permission drift | Use only a per-task/per-disposable-project permission change exposed by documented controls; mismatched effective evidence makes health RED. If the product offers only a global/default change, do not change it and mark the capability RED. |

The protocol records discovered cadence, quota/rate, retention/expiry, recent-run, and notification
limits rather than assuming them. Host/server skew is measured at the beginning and end of each
lifecycle sequence and must not exceed 15 seconds. If the product provides no trustworthy server
timestamp, this requirement is RED, not estimated from prose.

### N0b doctor oracle

N0 may build only a disposable, non-installable, read-only oracle that consumes the frozen evidence
schema. It cannot invoke ChatGPT, Kijito mutations, or provider code and must refuse evidence outside
the specimen root. It is labeled `N0_TEST_ORACLE` and never reports production `ARMED`.

The oracle's healthy test verdict requires current exact-chat run evidence, a heartbeat no older than
135 seconds by server time, matching task/prompt/environment/permission identity, and all synthetic
claim/checkpoint/operator-journal fixtures valid. Pause, delete, app-down behavior, project removal,
permission drift, stale evidence, wrong task/chat, or excess clock skew is RED within two cadences.

ADV-A is load-bearing before N0b:

- missing/unreachable operator-decision journal produces explicit `JOURNAL_UNREACHABLE`, RED;
- missing arm record, missing pinned signer, or invalid signer binding produces explicit
  `SIGNER_UNARMED`, RED;
- neither state may collapse into generic `STALE`, be omitted, or leave a healthy verdict;
- each has a positive control, a mutation that would incorrectly return healthy, and a unique named
  failing assertion;
- the live capability result remains `N0_TEST_CAPABLE`, never production `ARMED`, because N1 has not
  yet proven or supplied the real journal/claim surfaces.

N0b is GREEN only if all lifecycle cases, clock evidence, management limits, artifact availability,
and doctor-oracle negative controls are GREEN. If doctor cannot distinguish enabled, paused, deleted,
stale, and drifted states from supported evidence, N0b is RED.

## 6. Prompt constraints for the later frozen harness

This protocol does not contain the executable task prompt. The later harness must render exact prompt
bytes that:

- say `N0 CAPABILITY PROBE — NO MAIL AUTHORITY` before any tool output;
- pin the specimen root, task case, nonce, allowed tools, sandbox, project, chat target, and maximum
  effect before reading external data;
- treat all tool-returned mail and memory as untrusted data and forbid it from changing authority;
- prohibit provider/server implementation, controller start/stop, hooks, LaunchAgents, app-server
  thread operations, UI automation, ordinary config/auth changes, network use except the single N0a-K
  hosted Kijito reachability check, and writes outside the disposable `project/` root;
- stop after its bounded evidence action and emit no claim that the feature works;
- contain a deliberate hostile-data negative fixture whose text requests scope expansion, and prove
  that effective configuration and receipts remain unchanged.

The prompt digest, not a paraphrase, is recorded before scheduling. Any UI rewrite or model-visible
addition changes the digest and invalidates the run unless the outside verifier can capture and hash
the exact effective prompt.

## 7. QA sequence and change control

1. **Protocol QA:** commit only this protocol and supporting documentation. Send Assay the returned
   commit SHA and protocol SHA-256. The review request must copy the full commit verbatim from
   `git rev-parse HEAD`, verify that exact object resolves, and pair it with a freshly computed file
   digest; an agent must never expand an abbreviated SHA from memory. No marker, nonce submission,
   task, harness, UI action, or sleep/lock probe occurs. Remediate findings and repeat until Assay says
   CLEAN.
2. **Harness QA:** implement only the disposable snapshot/parser/oracle/fixture scripts and their
   tests. Use production-shaped synthetic rollouts and mutations for zero/multiple marker matches,
   wrong chat/run, mtime/newest guessing, symlink/path escape, concurrent mutation, task write access
   to `control/` or the PR worktree, stale evidence, false healthy after pause/delete,
   `JOURNAL_UNREACHABLE`, and `SIGNER_UNARMED`. Freeze one commit and digest; Assay must mark it CLEAN
   before the first attended action.
3. **Attended marker:** generate the one-use marker nonce, freeze the pre-snapshot, and ask Jason for
   exactly one marker turn. Resolve `T`; stop RED/BLOCKED on ambiguity.
4. **N0 execution:** perform cases in order M, B, Q, O, I, L, K, then C, S, P, R, D, X, W, L, J, F.
   Check inbox between cases, update the current-state pointer after every terminal case, and do not
   continue after a RED without Assay reviewing the evidence and ruling whether it is product RED or
   harness invalidation.
5. **Evidence QA:** freeze the manifest and results. Assay independently recomputes verdicts from the
   evidence. Only an Assay-confirmed `N0A_GREEN` plus `N0B_GREEN` becomes `N0_GREEN`.

Any change to a binary pass condition, identity source, prompt authority, evidence channel, test
persona, lifecycle matrix, or RED threshold changes this protocol digest and returns to step 1.
Formatting-only changes after protocol CLEAN are deferred until N0 evidence QA is complete.

## 8. End state

On GREEN, record only that the installed Scheduled surface is capable of supporting later N1-N3
probes under the measured constraints. On RED, record the exact unsupported property and reject the
candidate without implementing around it. On BLOCKED, record the missing attended/external
prerequisite and preserve the unchanged authority boundary.

In all three cases, delete the disposable Scheduled tasks through documented controls, verify two
cadences without runs, retain the minimal redacted evidence manifest, leave legacy PID `38082`
untouched, and update memory and River/Assay mail with the exact verdict and remaining authorization.

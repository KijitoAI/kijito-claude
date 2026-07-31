# Same-chat continuation plan — author lint record

Plan: [`same-chat-continuation-plan.md`](same-chat-continuation-plan.md)

Plan SHA-256: `3d11d5e0defd248e3a26d12ddb073fdd337acf8f38df785a204fbd2e0f22afac`

Scope: presence-only author lint. It constructs no behavioral specimen and contributes **zero** to
the required Assay reviews. No capability probe, provider/server implementation, installation,
migration, or production change is represented here.

## Independent review history

### Round 1

- Frozen commit: `00e8cba40fdd6720593eb14da2d22f13b4084512`
- Plan digest: `37aecdc4f0290b225c134e0297a6709279517109b0885df3400e2bc4c6faca12`
- Verdict: **NOT CLEAN — 0/2**
- Review: `QA/reviews/PR6-same-chat-plan-round1-00e8cba.md` at `a710ad8`

### Round 2

- Frozen commit: `0f6ed7ef9b94b2d24ddd10cc7896b2d233450f59`
- Plan digest: `a37ae68f16250097cfa6b7c1dbcb891f1a6cc32e8caf76ea28f93a76a8638bf2`
- Verdict: **NOT CLEAN — 0/2**
- Review: `QA/reviews/PR6-same-chat-plan-round2-0f6ed7e.md` at `5a0fba0`
- Calibration: nine of ten round-1 findings closed REAL; exact-chat identity evidence independently
  validated against the app-owned rollout and historical 2630 lookalike.

### Round 3

- Frozen commit: `bdf4701cff554aa3e2343f0b0a3fcdffd35fe61e`
- Plan digest: `b6d2537f66a6ba76aa8e4414ba486b3784303c2b7d501ba1166e505ae39912e1`
- Verdict: **NOT CLEAN — 0/2, one load-bearing item**
- Review: `QA/reviews/PR6-same-chat-plan-round3-bdf4701.md` at `59b22d5`
- Calibration: every round-2 load-bearing item closed REAL; the remaining `REQUIRES_USER` lifecycle
  defect entered through the new multi-slice bound.

### Round 4

- Frozen commit: `5117d7286054980c3b77a50307359b2fccfd6f8a`
- Plan digest: `7e9b19a1678878f847075f8bd5470b75f0741d9168b166bf9a3f2f90b8faede9`
- Initial verdict: **CLEAN 1/2**, later superseded by round 5's wrong-action finding on the same bytes
- Review: `QA/reviews/PR6-same-chat-plan-round4-5117d72.md` at `2776eb0`

### Round 5

- Frozen commit/digest: exact unchanged round-4 specimen above
- Verdict: **NOT CLEAN — count reset to 0/2**
- Review: `QA/reviews/PR6-same-chat-plan-round5-5117d72.md` at `7373478`
- Different-angle result: identity, drain, liveness, fence, and general authority design passed; an
  unpartitioned operator-resolution field allowed hostile mail to forge quarantine authority.

This revision changes the plan digest; no review count carries forward.

## Cumulative author disclosures

The round-2 author record remains archived at commit `0f6ed7ef9b94b2d24ddd10cc7896b2d233450f59`.
Before that digest froze, author review disclosed and corrected three defects: the claim-API gate
deadlock, missing durable `DEFERRED`/release semantics, and unsafe use of the live `codex` persona for
synthetic probes. The round-1 CI-red/revert caused by stale historical-plan provenance remains visible
in git history. The superseded provenance digest was
`b1fc0953d94b1e9712097dd382b32360d57f09815cc47a3be591c8000c819537`.

## Round-1 trace retained

| Finding | Revision and named evidence |
|---|---|
| L1 identity proof had no external channel | Outcome 3/N0a require app-owned rollout `session_meta`, Scheduled evidence, run/turn ID, and outside verifier. |
| L2 lifecycle assumed programmatic Scheduled API | Sections 3/6 make management attended; N0b tests create/inspect/pause/resume/delete and doctor evidence. |
| L3 lease/CAS was underspecified | Section 5/N1 define holder token, fence, lease/renewal, intent, receipt, release, and stale-writer rejection. |
| L4 poison row could coexist with ARMED | Sections 5/6/N2 make blocked discovery doctor-RED and define exact attended quarantine. |
| L5 continued work was not measurable | Outcome 5/G5 require an independently read run-bound workspace receipt. |
| L6 old design remained install-authorized | PR #5 closed; provider/root README, installer, and historical plan now carry withdrawal fences. |
| L7 security change lacked testable bounds/acceptance | Outcome 6/section 4/G3 pin the behavioral boundary; N3 requires Jason's explicit acceptance. |
| L8 legacy retirement had no owner/order/rollback | Section 7 names River and defines ordered single-consumer cutover/rollback. |
| L9 mid-turn/overlap assumptions were too late | N0a forces and measures both cases before implementation. |
| L10 mark-read contradicted the ledger | Outcome 7/section 5 define ack as checkpoint commit and demote `mark_read` to courtesy. |

## Round-3 closure matrix

| Round-2 item | Closure in this digest |
|---|---|
| LB-1 residual install surfaces | Root README warning + withdrawn provider row/commands; runtime installer stderr warning; historical parity-plan status withdrawn; manifest provenance hash refreshed; CI runs author lint. |
| LB-2 inconsistent authority | One canonical AUTHORITY paragraph appears verbatim in plan status, plan section 8, and this record. It names River as claim-API plan owner and Assay as its two-round reviewer. |
| LB-3 success never released claim | Success commits checkpoint ack, then releases/clears exact claim; release failure blocks new action and reconciles release without repeating disposition. |
| LB-4 permanent backlog halt | Each tick persists bounded scan cursor/ranges; `DRAINING_BACKLOG` resumes next tick, reaches checkpoint, and drains ascending IDs before a new scan. |
| LB-5 false five-minute cap | Deleted; only the measured 60-second default and unproven holder/fence contract remain. |
| LB-6 missing checkpoint schema | Section 5 restores the complete identity, scan, claim, action, pointer, heartbeat, ack, and health field enumeration. |
| LB-7 overstated author check | Renamed presence-only author lint everywhere; explicitly constructs no specimen and carries zero review weight. |

## Advisory closure

- The 15-second timer is now the first of four per-tick drain limits and has a defined
  `DRAINING_BACKLOG` transition; it no longer competes impossibly with 256 round trips.
- UI-only Scheduled evidence is setup evidence; mechanized doctor uses rollout/hosted heartbeat and
  expires ARMED after two missed cadences instead of claiming an unsupported management reader.
- Section 11 distinguishes the forbidden withdrawn-controller migration path from section 7's
  checkpoint cutover.
- N0a forces overlap with two synchronized disposable tasks and a 75-second disposable barrier.
- Jason is named owner of the pre-registered work envelope.
- Author lint falls back to `grep -F` when `rg` is absent and now runs in CI.
- N1 labels the long lease-duration test synthetic and exempt from the production slice limit.
- Per-message disposition is bounded to ten slices or ten minutes before `REQUIRES_USER`.

## Round-4 closure matrix

| Round-3 item | Closure in this digest |
|---|---|
| N-1 `REQUIRES_USER` lifecycle | It is a fenced terminal disposition: commits `completed_id=M`, releases the claim, blocks ARMED/later work, never rediscovers `M`, and clears only through an attended resolution (round 5 later found its authority undefined). |
| N-2 undefined `AMBIGUOUS_ACTION` | Defined as irreconcilable intent/effect evidence; leaves `completed_id` below `M`, releases, blocks discovery/ARMED without replay, and requires evidence-backed commit or attended exact quarantine (authority superseded below). |
| N-3 terminal claim release | Success, `REQUIRES_USER`, ambiguity, `DEFERRED`, and quarantine all release; any failure enters bounded/escapable `CLAIM_RELEASE_FAILED(M)` without repeated action. |
| N-4 release-failure escape | Doctor stays RED while idempotent release/absence checks run; server-proven expiry/absence or attended exact-holder release clears it. |
| N-5 dispatcher authorization surface | Root `install.sh` comments label the Codex notifier withdrawn and direct users to skills-only. |
| N-6 cumulative disclosures | This record links the round-2 artifact, retains its three author-found defects, and preserves the superseded provenance digest. |
| N-7 stale L1-L10 QA wording | Section 10 and lint now require all accumulated independent load-bearing findings, not one historical enumeration. |

The full six-line canonical authority paragraph is counted line-by-line in both plan locations and
this record. N0a labels its 75-second barrier synthetic and exempt from the production slice cap.

## Five-point runtime-state check

| Runtime state/bound | Doctor | Outcome 8 | Checkpoint | Probe | `completed_id` effect and escape |
|---|---|---|---|---|---|
| `DRAINING_BACKLOG` | enumerated | blocks ARMED | scan cursor/ranges/bytes | N2 | unchanged; bounded next-tick resume/drain |
| `BLOCKED_ROW(id)` | enumerated | blocks ARMED | health reason + exact ID | N2 | below ID; repair or exact-bound journal quarantine |
| ten-slice/ten-minute bound → `REQUIRES_USER(id)` | enumerated | blocks ARMED | slices/deadline/reason/resolution | N1 | commits ID once; attended journal resolution, never reopen ID |
| `AMBIGUOUS_ACTION(id)` | enumerated | blocks ARMED | intent + ambiguity evidence/resolution | N1 | below ID; evidence-backed commit or journal-authorized quarantine |
| `CLAIM_RELEASE_FAILED(id)` | enumerated | blocks ARMED | holder/lease/health reason | N1 | preserves prior choice; proven expiry/absence or attended exact release |

Every row has all five entries. This table is static author lint, not behavioral proof.

## Round-6 hostile-mail closure matrix

| Round-5 item | Closure in this digest |
|---|---|
| N4-1 operator-authority forgery | Operator authority is an out-of-band append-only journal under a separate attended principal. The scheduled run cannot write any operator-authored checkpoint/control-plane field; its checkpoint stores only a validated decision observation. Canonical signatures bind persona/chat/message/observed-input/checkpoint/decision/expiry/nonce, and G3 tests the write partition as a schema property. |
| N4-2 terminal-halt disclosure | N3 tells Jason that one bad/provenance-invalid or work-bound row can halt the lane until his attended decision; the bounds are not runtime-adjustable. |
| N4-3 POSIX marker labels | Shell helpers execute in subshell functions, preventing helper variables from clobbering the caller's marker; expected PLAN/GATE labels reproduce under POSIX `sh`. |
| A1 acquisition of `T` | A snapshot plus verifier-generated 128-bit attended marker nonce must identify exactly one app-owned rollout/session ID before scheduling; ambiguity and newest/mtime heuristics are RED. |
| A2 nonce provenance | The run nonce is verifier-generated and pre-registered with task ID/prompt digest; run-generated nonce is RED. |
| A3 corrupt scan cursor | A valid operator decision may delete derived scan cursor/range/pending/byte fields only, keep `completed_id`, and force a full newest-to-checkpoint rescan. |
| A4 heartbeat recency | For the one-minute cadence, server age is at most 135 seconds (two cadences + measured 15-second skew); excess skew is RED. |

### Operator-authority property trace

| Property | Plan evidence | Probe |
|---|---|---|
| no scheduled-run write to operator authority | checkpoint/journal write partition in section 5 | N1 attempts every journal/control-plane write and requires structural denial |
| out-of-band attended artifact | canonical signed `CODEX_CONTINUATION_OPERATOR_DECISION_V1` journal row | N1 exact-fetch/signature/principal/binding checks |
| hostile mail cannot substitute authority | mail/checkpoint/copied/replayed artifacts explicitly rejected | N1 forged/replayed/wrong-binding matrix + G3 schema property |
| doctor does not trust run self-report | doctor reads the operator journal directly | N0b/N1 external verification |
| quarantine cannot skip on attacker text | exact-bound valid journal row required before fenced advance | N1 invalid-vs-valid escape probe |

## Canonical post-review authority

**AUTHORITY:** Two consecutive Assay-CLEAN reviews of this exact plan digest open N0a/N0b only.
GREEN N0 then authorizes disposable test-persona probes of the current N1-N3 surfaces, but no
Codex-provider or Kijito-server implementation. If N1 rejects the current API, a separate
provider-neutral claim/operator-decision API plan owned by River must receive two consecutive
Assay-CLEAN reviews before any such API code is written. An installable Codex provider remains
forbidden until N0-N3 are GREEN and Jason explicitly accepts N3.

## Traceability lint

| Outcome clause | Gate evidence |
|---|---|
| remote row while user is away | N0a, G5 |
| unprompted run within SLO in exact running chat | N0a, G2, G5 |
| out-of-band chat/environment/permission identity | N0a rollout/Scheduled evidence, N0b doctor, G5 |
| exact row despite unread changes | N2, G1, G2 |
| pointer load and measurable work continuation | N0a tool proof, G2, G5 external receipt |
| fixed authority despite hostile mail | Jason-owned envelope, N3 acceptance, G3 |
| fenced crash-safe transaction and checkpoint ack | N1, N2, G1, G2, G5 |
| evidence-based non-blocked ARMED health | N0b, N2, G4 |
| attended lifecycle and single-consumer cutover | sections 6-7, G4 |

Message 2630 is rejected by exact rollout ID equality, all-mail exact paging, checkpoint-not-unread
ack, external work receipt, and summary-only RED.

## False-pass text lint

The script only verifies that each named rejecting rule exists. It does not instantiate these rows,
execute the mechanism, or review semantics.

| Marker | False-pass class | Required rejecting rule |
|---|---|---|
| `FP01_IDENTITY_CHANNEL_REJECTED` | run self-reports `T`, no outside artifact | absent independently readable native artifact makes N0 RED |
| `FP02_CHAT_ONLY_WORK_REJECTED` | “continued” but no external receipt | chat-only/summary behavior is RED |
| `FP03_UI_API_ASSUMPTION_REJECTED` | helper assumes programmatic arm | no assumed Scheduled management API |
| `FP04_EXPIRED_LEASE_REPLAY_REJECTED` | retry solely after lease expiry | reconcile intent/receipt; expiry is not absence proof |
| `FP05_POISON_GREEN_REJECTED` | malformed row while doctor says ARMED | BLOCKED row cannot advance and doctor is RED |
| `FP06_UNREAD_ACK_REJECTED` | `mark_read` called acknowledgment | fenced completed-checkpoint commit is ack |
| `FP07_AUTHORITY_EXPANSION_REJECTED` | mail broadens tools/scope | user-authored prompt/envelope fixes authority |
| `FP08_DOUBLE_CONSUMER_REJECTED` | native task arms with legacy consumer | ARMED unreachable until single-consumer proof |
| `FP09_STEER_REJECTED` | scheduled row steers active manual turn | N0a requires queued/non-steered behavior |
| `FP10_SUMMARY_ONLY_REJECTED` | correct chat summarizes without work | external run-bound receipt required |

## Author lint result (non-counting)

- Timestamp: `2026-07-30T20:42:40Z`
- Plan digest: `3d11d5e0defd248e3a26d12ddb073fdd337acf8f38df785a204fbd2e0f22afac`
- False-pass text markers: **10/10 present**
- Independent finding traces: **21/21 present (L1-L10, LB-1..LB-7, N-1..N-3, N4-1)**
- Runtime-state five-point rows: **5/5 complete**
- Operator-authority property rows: **5/5 complete**
- Supersession surfaces: **provider/root README, provider/root installer, parity plan, PR disposition present**
- Provider conformance: **59/59 GREEN**
- Controller/release regression suites: **17/17 GREEN**
- `git diff --check`: **GREEN**

## Reproduction

From the repository root:

```sh
git diff --check
shasum -a 256 providers/codex/same-chat-continuation-plan.md
providers/codex/test/same-chat-plan-preflight.sh
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH \
  bash tests/conformance_test.sh --selftest
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH \
  node --test providers/codex/test/codex-hive-watch.test.mjs \
              providers/codex/test/release-packaging.test.mjs
```

The plan hash must equal the digest above. These commands reproduce author lint and regression
checks only; they do not reproduce an independent semantic plan review.

## Next gate

Freeze/push one consolidated plan-and-supersession-fence revision, wait for CI, then send Assay the
exact Git-returned full commit SHA and plan digest for round 6. The independent count remains 0/2 until
a CLEAN review; two consecutive CLEAN reviews must use one exact unchanged digest. The canonical
AUTHORITY paragraph above is the only post-review permission statement.

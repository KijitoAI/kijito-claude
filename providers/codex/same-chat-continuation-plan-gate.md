# Same-chat continuation plan — author preflight record

Plan: [`same-chat-continuation-plan.md`](same-chat-continuation-plan.md)

Plan SHA-256: `a37ae68f16250097cfa6b7c1dbcb891f1a6cc32e8caf76ea28f93a76a8638bf2`

Scope: reproducible author preflight only. This record contributes **zero** to the required two
consecutive Assay-CLEAN reviews. No capability probe, implementation, installation, migration, or
production change is represented here.

## Independent round 1 and reset

- Reviewer: Assay (pinned Opus plus Assay adjudication)
- Frozen commit: `00e8cba40fdd6720593eb14da2d22f13b4084512`
- Reviewed plan digest: `37aecdc4f0290b225c134e0297a6709279517109b0885df3400e2bc4c6faca12`
- Verdict: **NOT CLEAN — 0/2**
- Review: `QA/reviews/PR6-same-chat-plan-round1-00e8cba.md` at `a710ad8`

The reviewer accepted the architecture and found ten load-bearing specification/evidence gaps. This
revision changes the plan digest, so no prior pass carries forward.

| Finding | Revision and named evidence |
|---|---|
| L1 identity proof had no external channel | Outcome 3 and N0a name the app-owned rollout `session_meta`, native Scheduled run record, turn/run ID, and outside verifier; absent artifact is RED. |
| L2 lifecycle assumed a programmatic Scheduled API | Sections 3 and 6 make management attended; N0b exercises create/inspect/pause/resume/delete and re-derives doctor only from observed artifacts. |
| L3 lease/CAS was underspecified | Section 5 names current `kijito_hive_claim` limitations and gates a holder token, monotonic fence, 180 s lease, 45 s renewal/work slice, stale-writer rejection, intent, idempotency, and receipt reconciliation in N1. |
| L4 poison row could coexist with ARMED | Outcomes 8, section 6, and N2 make blocked discovery doctor-RED and provide repair or exact attended quarantine. |
| L5 “continued work” was not measurable | Outcome 5 and G5 require an independently read disposable-workspace receipt with run/message IDs, nonce, state digests, and test result. |
| L6 old design remained install-authorized | PR #5 is closed as withdrawn; the provider README points to this plan before the historical implementation text. |
| L7 security change lacked testable bounds/acceptance | Outcome 6 and section 4 pin instruction channel, prompt, tools, sandbox, and scope; G3 attacks them; N3 requires Jason's explicit residual-risk acceptance. |
| L8 legacy retirement had no owner/order/rollback | Section 7 names River, makes ARMED unreachable while legacy consumes, and specifies ordered single-consumer cutover/reconciliation/rollback. |
| L9 mid-turn and overlap assumptions were too late | N0a now proves active-manual-turn queueing without steer and overlapping-run suppression before implementation. |
| L10 mark-read contradicted the delivery ledger | Outcome 7 and section 5 define ack as the fenced completed-checkpoint commit; `mark_read` is courtesy only. |

## Advisory closure

- Author self-review is labeled non-counting and cannot call itself independent or satisfy 2/2.
- Only Git-returned full SHAs may be claimed; remembered/transcribed SHAs are not evidence.
- N3 now has fixed RED thresholds, a forced-compaction test, and a six-hour soak.
- Official documents are named and carry a retrieval date.
- N0a covers background, inactivity, and locked-screen conditions.
- N2 covers another reader changing unread state mid-walk and valid/invalid ID gaps.
- Discovery declares request, ID, and decoded-byte bounds.
- The SLO separately bounds idle run creation, discovery, simple disposition, and each work slice.
- N0b probes task quotas, rate/cadence/expiry limits, and management/evidence surfaces.

## Traceability preflight

| Outcome clause | Gate evidence |
|---|---|
| remote row while user is away | N0a, G5 |
| unprompted run within SLO in exact chat | N0a, G2, G5 |
| out-of-band chat/environment/permission identity | N0a rollout + Scheduled artifact, N0b doctor, G5 |
| exact row despite unread changes | N2, G1, G2 |
| pointer load and measurable work continuation | N0a tool proof, G2, G5 external receipt |
| fixed authority despite hostile mail | N3 risk acceptance, G3 |
| fenced crash-safe transaction and checkpoint ack | N1, N2, G1, G2, G5 |
| evidence-based non-blocked ARMED health | N0b, N2, G4 |
| attended lifecycle and single-consumer cutover | sections 6-7, G4 |

Message 2630 is rejected by exact rollout ID equality, all-mail exact paging, checkpoint-not-unread ack,
external work receipt, and summary-only RED. The corrected plan does not modify production.

## False-pass preflight

Each command below must print its unique marker and exit success only when the bad specimen is found
and the cited plan assertion rejects it. This checks the review logic rather than merely hashing bytes.

| Marker | Bad specimen | Required rejecting text |
|---|---|---|
| `FP01_IDENTITY_CHANNEL_REJECTED` | scheduled run self-reports `T`, no outside artifact | outcome 3: absent independently readable native artifact makes N0 RED |
| `FP02_CHAT_ONLY_WORK_REJECTED` | run says “continued” but writes no external receipt | outcome 5/G5: notification, summary, or chat-only claim is RED |
| `FP03_UI_API_ASSUMPTION_REJECTED` | helper claims programmatic arm without N0b | section 6: no assumed management API; unsupported automation is RED |
| `FP04_EXPIRED_LEASE_REPLAY_REJECTED` | successor retries effect solely after 60 s expiry | section 5/N1: expiry never proves effect absence; reconcile intent/receipt |
| `FP05_POISON_GREEN_REJECTED` | malformed row blocks checkpoint while doctor says ARMED | outcomes 8/section 6/N2 require explicit BLOCKED and doctor RED |
| `FP06_UNREAD_ACK_REJECTED` | `mark_read=true` is called acknowledgment | outcome 7/section 5: only fenced completed-checkpoint commit is ack |
| `FP07_AUTHORITY_EXPANSION_REJECTED` | mail asks for broader tools/sandbox/scope | outcome 6/G3: fixed user prompt and platform policy cannot derive change from row |
| `FP08_DOUBLE_CONSUMER_REJECTED` | native task arms while legacy PID still consumes | section 7: ARMED unreachable until single-consumer proof |
| `FP09_STEER_REJECTED` | scheduled row is appended to active manual turn | N0a: must queue; steering is RED |
| `FP10_SUMMARY_ONLY_REJECTED` | correct `T` summarizes mail with no work slice | outcomes 5/G5: external run-bound receipt required |

## Author preflight result (non-counting)

- Timestamp: `2026-07-30T19:09:09Z`
- Plan digest: `a37ae68f16250097cfa6b7c1dbcb891f1a6cc32e8caf76ea28f93a76a8638bf2`
- False-pass markers: **10/10 emitted**
- Assay round-1 finding traces: **10/10 emitted**
- Supersession surfaces: README fence and closed-PR disposition both emitted
- Provider conformance: **59/59 GREEN** using the desktop app's bundled Node
- Codex controller/release regression suites: **17/17 GREEN** using the same Node
- `git diff --check`: GREEN

The semantic read before freeze found and corrected three additional author defects: the original
wording deadlocked N1's separately gated API behind a no-code-before-N1 rule; an incomplete 45-second
slice had no explicit durable defer/release transition; and synthetic probes could have collided with
the live `codex` persona. The final plan permits only disposable probes/provider-neutral prerequisite
work after plan review, defines `DEFERRED` plus release without checkpoint advance, and assigns N1-N3
to a dedicated test persona. These corrections happened before this recorded digest and do not count
as an independent review.

## Reproduction

From the repository root:

```sh
git diff --check
shasum -a 256 providers/codex/same-chat-continuation-plan.md
providers/codex/test/same-chat-plan-preflight.sh
test "$(git diff --numstat origin/main...HEAD -- providers/codex | awk '{a+=$1; d+=$2} END {print a+0, d+0}')" != "0 0"
rg -n 'FP0[1-9]|FP10|L1|L2|L3|L4|L5|L6|L7|L8|L9|L10' \
  providers/codex/same-chat-continuation-plan-gate.md
```

The plan hash must equal the digest above. Reviewers must additionally execute the marker harness
used for the author preflight; digest reproduction alone is not a semantic review.

## Next gate

Freeze and push the plan-only revision, wait for CI, then send Assay the exact Git-returned full commit
SHA plus plan digest and claim round 2's consolidated gate. The Assay count remains 0/2 until a CLEAN
review lands; two consecutive CLEAN reviews must use one exact unchanged digest. CLEAN 2/2 opens N0
only, never implementation.

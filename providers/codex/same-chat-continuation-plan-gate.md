# Same-chat continuation plan — internal gate record

Plan: [`same-chat-continuation-plan.md`](same-chat-continuation-plan.md)

Plan SHA-256: `37aecdc4f0290b225c134e0297a6709279517109b0885df3400e2bc4c6faca12`

Scope: semantic plan QA only. No capability probe, implementation, installation, migration, or
production change is represented by this record.

## Reset history before the counted passes

Three load-bearing findings were fixed before the plan digest froze, so none counts as a green pass:

1. N0 initially proved same-chat scheduling but not that a scheduled run has the installed
   `kijito-start` skill, hosted Kijito MCP, and read-only inbox capability. N0 now proves those.
2. Same-chat identity initially omitted execution environment and permissions. A task could have
   passed in the right chat but wrong worktree/project or permission profile. Outcome, arm, doctor,
   and N0 now bind and verify all three.
3. N3 initially measured token cost and interference but not visible empty-run noise,
   transcript/context growth, or compaction pressure. Those are now measured and require Jason's
   explicit acceptance.

## Counted pass 1 — traceability

- Reviewer: Codex self-review
- Timestamp: `2026-07-30T18:38:46Z`
- Plan digest: `37aecdc4f0290b225c134e0297a6709279517109b0885df3400e2bc4c6faca12`
- Verdict: **GREEN (1/2)**
- Load-bearing findings: none
- Cosmetic disclosures: none

Outcome trace:

| Outcome clause | Gate evidence |
|---|---|
| away + remote message | N0, G5 |
| unprompted run within SLO in exact chat | N0, G2, G5 |
| immutable chat/environment/permission identity | N0, doctor/G4, G5 |
| exact row despite read state | N2, G1, G2 |
| pointer load and actual work continuation | N0 tool proof, G2, G5 |
| untrusted mail cannot create authority | G3 plus fixed authority rule |
| claim, crash recovery, exact acknowledgment | N1, N2, G1, G2, G5 |
| evidence-based ARMED health | N0, N3, doctor/G4 |
| lifecycle, ownership, rollback, no hooks/duplicate | G4 and arming lifecycle |

Message-2630 trace:

- isolated thread is rejected in the decision, N0 identity, and G5;
- read/handled divergence is addressed by read-independent paging and N2;
- checkpoint advancement before action is replaced by claim/disposition/ack ordering in N1/N2;
- summary-only output is explicitly RED in the outcome contract and G5;
- production migration is forbidden during planning.

State-change trace:

- schedule: owned by recorded task/chat/environment identity; rollback is pause/uninstall; evidence is
  native metadata, self-test, and doctor;
- checkpoint/claim: owned by persona/chat CAS; rollback is stale-claim reconciliation; evidence is
  claim nonce, run ID, pointer version, and completed ID;
- inbox acknowledgment: exact-ID refetch after disposition; failure blocks checkpoint advancement;
- implementation/integration/production: separate owners and gates; this plan grants none.

## Counted pass 2 — false-pass resistance

- Reviewer: Codex adversarial self-review
- Timestamp: `2026-07-30T18:38:56Z`
- Plan digest: `37aecdc4f0290b225c134e0297a6709279517109b0885df3400e2bc4c6faca12`
- Verdict: **GREEN (2/2 — INTERNAL GOLDEN)**
- Load-bearing findings: none
- Cosmetic disclosures: none

| False-pass specimen | Named rejection |
|---|---|
| dedicated controller thread receives mail | N0 destination ID mismatch; G5 exact-chat assertion |
| human manually prompts the apparent wake | N0 unprompted/native-run assertion |
| visually similar chat or cwd-only match | outcome identity rule; N0 native chat/environment metadata |
| right chat, wrong project/worktree or permissions | N0 environment/profile equality; doctor drift check |
| scheduled run lacks Kijito skill/MCP | N0 hosted-brain/tool capability proof |
| unread-only query misses an already-read row | discovery requires all-mail paging; N2 already-read case |
| duplicate task/run claims one row | N1 compare-and-set one-winner assertion |
| crash overwrites or blindly repeats a claim | N1 crash-reconciliation assertion |
| exact-refetch returns predecessor/missing row | ID equality assertion; N2 cannot advance |
| oversized/truncated row is treated as complete | N2 BLOCKED/no-ack assertion |
| stale/disabled/wrong-chat task reports ARMED | doctor and G4 health assertions |
| second/legacy consumer advances the stream | doctor/G4 hard double-consumer fence |
| task only announces or summarizes mail | outcome clause 5 and G5 summary-only RED |
| idle polling floods context but is called cheap/silent | N3 measured noise/context/compaction + explicit acceptance |
| App Server guesses the desktop thread | conditional-alternative supported-registration gate |

## Reproduction

From the repository root:

```sh
git diff --check
shasum -a 256 providers/codex/same-chat-continuation-plan.md
rg -n 'N0|N1|N2|N3|G1|G2|G3|G4|G5' providers/codex/same-chat-continuation-plan.md
```

The hash must equal the digest above. Any plan-byte change invalidates both counted passes.

## Next gate

Freeze and push the plan-only branch, then ask Assay to independently review the exact commit and
digest. INTERNAL GOLDEN opens review only; it does not open N0 or implementation.


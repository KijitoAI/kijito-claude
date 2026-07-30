#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$root/../.." && pwd)
plan="$root/same-chat-continuation-plan.md"
gate="$root/same-chat-continuation-plan-gate.md"
readme="$root/README.md"
repo_readme="$repo/README.md"
installer="$root/install.mjs"
parity_plan="$root/codex-kijito-parity-plan.md"
dispatcher="$repo/install.sh"

must_contain() {
  file=$1
  needle=$2
  marker=$3
  if command -v rg >/dev/null 2>&1; then
    rg -F -q -- "$needle" "$file"
  else
    grep -F -q -- "$needle" "$file"
  fi || {
    printf 'RED %s missing: %s\n' "$marker" "$needle" >&2
    exit 1
  }
  printf '%s\n' "$marker"
}

must_not_contain() {
  file=$1
  needle=$2
  marker=$3
  if command -v rg >/dev/null 2>&1; then
    found=$(rg -F -c -- "$needle" "$file" || true)
  else
    found=$(grep -F -c -- "$needle" "$file" || true)
  fi
  found=${found:-0}
  if [ "$found" -ne 0 ]; then
    printf 'RED %s forbidden: %s\n' "$marker" "$needle" >&2
    exit 1
  fi
}

must_count() {
  file=$1
  needle=$2
  expected=$3
  marker=$4
  if command -v rg >/dev/null 2>&1; then
    found=$(rg -F -c -- "$needle" "$file" || true)
  else
    found=$(grep -F -c -- "$needle" "$file" || true)
  fi
  found=${found:-0}
  if [ "$found" -ne "$expected" ]; then
    printf 'RED %s expected %s occurrence(s), found %s: %s\n' \
      "$marker" "$expected" "$found" "$needle" >&2
    exit 1
  fi
  printf '%s\n' "$marker"
}

must_authority_line() {
  line=$1
  marker=$2
  must_count "$plan" "$line" 2 "${marker}_PLAN"
  must_count "$gate" "$line" 1 "${marker}_GATE"
}

# Each marker names a false-pass class in the gate record and is emitted only when the corresponding
# rejection text is present. This is static presence lint; it does not construct a specimen.
must_contain "$plan" "If Jason's installed build exposes no such independently" \
  "FP01_IDENTITY_CHANNEL_REJECTED"
must_contain "$plan" "a receipt without the matching native run identity is RED" \
  "FP02_CHAT_ONLY_WORK_REJECTED"
must_contain "$plan" "There is no assumed programmatic Scheduled management API" \
  "FP03_UI_API_ASSUMPTION_REJECTED"
must_contain "$plan" "never retries solely because the lease expired" \
  "FP04_EXPIRED_LEASE_REPLAY_REJECTED"
must_contain "$plan" '`BLOCKED_ROW(<id>)` and cannot advance the checkpoint' \
  "FP05_POISON_GREEN_REJECTED"
must_contain "$plan" '`mark_read=true` is courtesy presentation metadata' \
  "FP06_UNREAD_ACK_REJECTED"
must_contain "$plan" "The versioned, user-authored prompt fixes the allowed tools" \
  "FP07_AUTHORITY_EXPANSION_REJECTED"
must_contain "$plan" "ARMED is unreachable while PID 38082 or any legacy notifier" \
  "FP08_DOUBLE_CONSUMER_REJECTED"
must_contain "$plan" "proving the scheduled input queues and never uses steering" \
  "FP09_STEER_REJECTED"
must_contain "$plan" "Notification, summary," \
  "FP10_SUMMARY_ONLY_REJECTED"

for finding in L1 L2 L3 L4 L5 L6 L7 L8 L9 L10; do
  must_contain "$gate" "| $finding " "ROUND1_${finding}_TRACED"
done
for finding in LB-1 LB-2 LB-3 LB-4 LB-5 LB-6 LB-7; do
  must_contain "$gate" "| $finding " "ROUND2_${finding}_TRACED"
done
for finding in N-1 N-2 N-3; do
  must_contain "$gate" "| $finding " "ROUND3_${finding}_TRACED"
done

must_contain "$readme" "Do not install, upgrade, migrate" "WITHDRAWN_README_FENCE_PRESENT"
must_contain "$repo_readme" 'Codex dedicated-thread provider withdrawn' \
  "WITHDRAWN_ROOT_README_FENCE_PRESENT"
must_contain "$installer" "WITHDRAWN: dedicated-thread notifier is not same-running-session wake" \
  "WITHDRAWN_INSTALLER_FENCE_PRESENT"
must_contain "$dispatcher" "WITHDRAWN notifier; skills-only remains safe" \
  "WITHDRAWN_DISPATCHER_FENCE_PRESENT"
must_contain "$parity_plan" "this historical plan does not authorize installation" \
  "WITHDRAWN_PARITY_PLAN_FENCE_PRESENT"
must_contain "$plan" "PR #5 is closed as withdrawn" "WITHDRAWN_PR_DISPOSITION_PRESENT"
must_contain "$plan" 'segments, bytes, and start time as `DRAINING_BACKLOG`' \
  "PARTIAL_BACKLOG_DRAIN_PRESENT"
must_contain "$plan" 'Any release failure enters `CLAIM_RELEASE_FAILED(M)`' \
  "CLAIM_RELEASE_FAILURE_FENCE_PRESENT"
must_contain "$plan" '`REQUIRES_USER(M)` is a fenced terminal disposition, not a retry state.' \
  "REQUIRES_USER_TERMINAL_PRESENT"
must_contain "$plan" '`AMBIGUOUS_ACTION(M)` means crash reconciliation cannot prove' \
  "AMBIGUOUS_ACTION_DEFINED"
must_contain "$plan" 'For every runtime state or production execution bound added by a revision' \
  "FIVE_POINT_STATE_CHECK_PRESENT"
must_contain "$gate" '| `DRAINING_BACKLOG` | enumerated | blocks ARMED |' \
  "STATE_DRAINING_FIVE_POINT_TRACED"
must_contain "$gate" '| `BLOCKED_ROW(id)` | enumerated | blocks ARMED |' \
  "STATE_BLOCKED_ROW_FIVE_POINT_TRACED"
must_contain "$gate" '| ten-slice/ten-minute bound → `REQUIRES_USER(id)` | enumerated | blocks ARMED |' \
  "STATE_REQUIRES_USER_FIVE_POINT_TRACED"
must_contain "$gate" '| `AMBIGUOUS_ACTION(id)` | enumerated | blocks ARMED |' \
  "STATE_AMBIGUOUS_ACTION_FIVE_POINT_TRACED"
must_contain "$gate" '| `CLAIM_RELEASE_FAILED(id)` | enumerated | blocks ARMED |' \
  "STATE_CLAIM_RELEASE_FAILED_FIVE_POINT_TRACED"
must_authority_line "**AUTHORITY:** Two consecutive Assay-CLEAN reviews of this exact plan digest open N0a/N0b only." \
  "CANONICAL_AUTHORITY_LINE1"
must_authority_line "GREEN N0 then authorizes disposable test-persona probes of the current N1-N3 surfaces, but no" \
  "CANONICAL_AUTHORITY_LINE2"
must_authority_line "Codex-provider or Kijito-server implementation. If N1 rejects the current API, a separate" \
  "CANONICAL_AUTHORITY_LINE3"
must_authority_line "provider-neutral claim-API plan owned by River must receive two consecutive Assay-CLEAN reviews" \
  "CANONICAL_AUTHORITY_LINE4"
must_authority_line "before any claim-API code is written. An installable Codex provider remains forbidden until N0-N3" \
  "CANONICAL_AUTHORITY_LINE5"
must_authority_line "are GREEN and Jason explicitly accepts N3." \
  "CANONICAL_AUTHORITY_LINE6"
must_not_contain "$gate" "INTERNAL GOLDEN" "NO_SELF_ATTESTED_GOLDEN"
must_not_contain "$plan" "Only Assay CLEAN opens N0" "NO_SINGLE_CLEAN_GATE"

printf 'PLAN_AUTHOR_PREFLIGHT_GREEN\n'

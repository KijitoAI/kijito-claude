#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
plan="$root/same-chat-continuation-plan.md"
gate="$root/same-chat-continuation-plan-gate.md"
readme="$root/README.md"

must_contain() {
  file=$1
  needle=$2
  marker=$3
  if ! rg -F -q -- "$needle" "$file"; then
    printf 'RED %s missing: %s\n' "$marker" "$needle" >&2
    exit 1
  fi
  printf '%s\n' "$marker"
}

must_not_contain() {
  file=$1
  needle=$2
  marker=$3
  if rg -F -q -- "$needle" "$file"; then
    printf 'RED %s forbidden: %s\n' "$marker" "$needle" >&2
    exit 1
  fi
}

# Each marker corresponds to a bad specimen in the gate record and is emitted only when the
# load-bearing rejecting rule is present in the frozen plan.
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

must_contain "$readme" "Do not install, upgrade, migrate" "WITHDRAWN_README_FENCE_PRESENT"
must_contain "$plan" "PR #5 is closed as withdrawn" "WITHDRAWN_PR_DISPOSITION_PRESENT"
must_not_contain "$gate" "INTERNAL GOLDEN" "NO_SELF_ATTESTED_GOLDEN"
must_not_contain "$plan" "Only Assay CLEAN opens N0" "NO_SINGLE_CLEAN_GATE"

printf 'PLAN_AUTHOR_PREFLIGHT_GREEN\n'

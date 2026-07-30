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

must_contain "$readme" "Do not install, upgrade, migrate" "WITHDRAWN_README_FENCE_PRESENT"
must_contain "$repo_readme" 'Codex dedicated-thread provider withdrawn' \
  "WITHDRAWN_ROOT_README_FENCE_PRESENT"
must_contain "$installer" "WITHDRAWN: dedicated-thread notifier is not same-running-session wake" \
  "WITHDRAWN_INSTALLER_FENCE_PRESENT"
must_contain "$parity_plan" "this historical plan does not authorize installation" \
  "WITHDRAWN_PARITY_PLAN_FENCE_PRESENT"
must_contain "$plan" "PR #5 is closed as withdrawn" "WITHDRAWN_PR_DISPOSITION_PRESENT"
must_contain "$plan" 'segments, bytes, and start time as `DRAINING_BACKLOG`' \
  "PARTIAL_BACKLOG_DRAIN_PRESENT"
must_contain "$plan" 'Release failure records `CLAIM_RELEASE_FAILED`, blocks new action' \
  "CLAIM_RELEASE_FAILURE_FENCE_PRESENT"
must_count "$plan" "**AUTHORITY:** Two consecutive Assay-CLEAN reviews of this exact plan digest open N0a/N0b only." 2 \
  "CANONICAL_AUTHORITY_PLAN_COUNT"
must_count "$gate" "**AUTHORITY:** Two consecutive Assay-CLEAN reviews of this exact plan digest open N0a/N0b only." 1 \
  "CANONICAL_AUTHORITY_GATE_COUNT"
must_not_contain "$gate" "INTERNAL GOLDEN" "NO_SELF_ATTESTED_GOLDEN"
must_not_contain "$plan" "Only Assay CLEAN opens N0" "NO_SINGLE_CLEAN_GATE"

printf 'PLAN_AUTHOR_PREFLIGHT_GREEN\n'

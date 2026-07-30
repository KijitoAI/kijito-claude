#!/usr/bin/env bash
# Record that /kijito-qa-memory Phase-4 cold-boot verification PASSED for THIS session.
# self-clear.sh REQUIRES a fresh token from this before it will fire (gate C1) — i.e. you
# cannot self-clear without a passing cold-boot verify. The token is consumed by one /clear.
# Resolve the shared lib NEXT TO THIS SCRIPT so the repo copy is runnable/testable in place, and
# fall back to the installed location for a stray single-file copy. KIJITO_LC_LIB overrides both.
_kjt_lib="${KIJITO_LC_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lifecycle-lib.sh}"
[ -f "$_kjt_lib" ] || _kjt_lib="$HOME/.claude/lifecycle-lib.sh"
. "$_kjt_lib"
lc_now > "$(lc_qa_token)"
lc_log QA_PASS "cold-boot verified"
echo "Recorded kijito-qa-memory pass for session ${CLAUDE_CODE_SESSION_ID:-?}. self-clear unlocked for ONE clear."

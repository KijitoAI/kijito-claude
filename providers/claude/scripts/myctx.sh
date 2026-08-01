#!/usr/bin/env bash
# "How full am I, really?" — hard data vs. gut. Run this when you FEEL full.
# Bulletproof: finds THIS session's transcript via CLAUDE_CODE_SESSION_ID (no
# "newest file" guessing), then reads the API's own token ledger (== /context).
#
# ⛔ THIS SCRIPT USED TO PRINT A CONFIDENT `0.0%` WHEN IT COULD NOT MEASURE, AND THAT IS WRONG IN
# THE ONE DIRECTION THAT COSTS SOMETHING. Found by ladybug 2026-08-01, hit live at a session start.
# On the FIRST tool call of a session the transcript carries no assistant row with `.message.usage`
# yet; `last // {}` then yields `{}`, the arithmetic gives 0, and the output read:
#     context: 0 tok = 0.0% of 1000k   (free: 100.0%, ~1000000 tok)
# The ONE caller whose entire job is deciding whether to recycle was told it had a full window.
#
# ★ 0 IS NOT A POSSIBLE ANSWER IN A LIVE SESSION — the system prompt alone is thousands of tokens —
# so a 0 here has only ever meant "I could not read the ledger". A meter that cannot distinguish
# EMPTY from CANNOT-MEASURE is worse than no meter, because the felt-sense it exists to override is
# at least known to be unreliable. ⇒ REFUSE, LOUDLY, ON STDERR, WITH A NON-ZERO EXIT. This is the
# same rule the gate runner lives by: "I could not check" is BLOCKED, never a green number.
set -u

command -v jq >/dev/null 2>&1 || {
  echo "myctx: UNMEASURABLE — jq is not on PATH, so the token ledger cannot be read." >&2; exit 1; }

sid="${CLAUDE_CODE_SESSION_ID:?CLAUDE_CODE_SESSION_ID not set}"
# Quote the search root: an unquoted ~/.claude/projects breaks on a HOME containing spaces, which
# is not exotic on macOS.
f=$(find "$HOME/.claude/projects" -name "$sid.jsonl" 2>/dev/null | head -1)
[ -z "$f" ] && { echo "myctx: UNMEASURABLE — no transcript for session $sid" >&2; exit 1; }

win="${CTX_WINDOW:-1000000}"
used=$(jq -s 'map(select(.type=="assistant" and .message.usage!=null).message.usage)|last // {}
              |(.input_tokens//0)+(.cache_read_input_tokens//0)+(.cache_creation_input_tokens//0)' "$f")

# Refuse rather than report. `0` is folded in with empty/null deliberately — see the header.
case "$used" in
  ''|null|0)
    echo "myctx: UNMEASURABLE — this session's token ledger is not populated yet (no assistant turn" >&2
    echo "       has been flushed to the transcript). NORMAL on the first tool call of a session." >&2
    echo "       Read the live <total_tokens> count instead. DO NOT read this as 0%." >&2
    exit 1 ;;
  *[!0-9]*)
    echo "myctx: UNMEASURABLE — non-numeric ledger value ('$used')" >&2
    exit 1 ;;
esac

awk -v u="$used" -v w="$win" 'BEGIN{
  printf "context: %d tok = %.1f%% of %dk   (free: %.1f%%, ~%d tok)\n", u, u/w*100, w/1000, (1-u/w)*100, w-u }'

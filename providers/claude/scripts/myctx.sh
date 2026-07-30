#!/usr/bin/env bash
# "How full am I, really?" — hard data vs. gut. Run this when you FEEL full.
# Bulletproof: finds THIS session's transcript via CLAUDE_CODE_SESSION_ID (no
# "newest file" guessing), then reads the API's own token ledger (== /context).
sid="${CLAUDE_CODE_SESSION_ID:?CLAUDE_CODE_SESSION_ID not set}"
f=$(find ~/.claude/projects -name "$sid.jsonl" 2>/dev/null | head -1)
[ -z "$f" ] && { echo "no transcript for session $sid"; exit 1; }
win="${CTX_WINDOW:-1000000}"
used=$(jq -s 'map(select(.type=="assistant" and .message.usage!=null).message.usage)|last // {}
              |(.input_tokens//0)+(.cache_read_input_tokens//0)+(.cache_creation_input_tokens//0)' "$f")
awk -v u="$used" -v w="$win" 'BEGIN{
  printf "context: %d tok = %.1f%% of %dk   (free: %.1f%%, ~%d tok)\n", u, u/w*100, w/1000, (1-u/w)*100, w-u }'

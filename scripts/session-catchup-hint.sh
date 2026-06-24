#!/usr/bin/env bash
# SessionStart hook → (1) ALWAYS print a passive catch-up reminder (additionalContext via stdout),
# (2) ARMED auto-send: if this pane is armed (claude-armed.sh marker or KIJITO_AUTOCATCHUP=1) and
# we're in tmux, instigate the first turn by typing the prompt into our own pane.
. "$HOME/.claude/lifecycle-lib.sh" 2>/dev/null
src=$(cat 2>/dev/null | jq -r '.source // "startup"' 2>/dev/null); [ -z "$src" ] && src=startup
case "$src" in
  clear)   pre="You just /clear'd — context was intentionally reset to a clean slate." ;;
  compact) pre="Context was just compacted — detail was summarized away; memory is now the source of truth." ;;
  *)       pre="New session." ;;
esac
cat <<EOF
[SESSION CATCH-UP — do this BEFORE the user's task] $pre Start continuous, not cold:
1) kijito_startup(persona, project) → read the current-state pointer it names (kijito_get) → skim recent lessons.
2) Arm your inbox watcher.
3) If this is a BRAND-NEW project with NO persona yet: read ./CLAUDE.md + ~/.claude/CLAUDE.md and set your persona/project before writing any memory.
Never pause on a *feeling* of full context — run ~/.claude/myctx.sh for hard data.
EOF

# Armed auto-send (detached so it never blocks startup or pollutes the additionalContext above).
if command -v lc_is_armed >/dev/null 2>&1 && [ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ] && lc_is_armed "$TMUX_PANE"; then
  lc_log HOOK "src=$src autosend=ARMED pane=$TMUX_PANE"
  nohup bash "$HOME/.claude/session-autosend.sh" "$TMUX_PANE" >/dev/null 2>&1 &
else
  command -v lc_log >/dev/null 2>&1 && lc_log HOOK "src=$src autosend=skip(not-armed-or-no-tmux) tmux=${TMUX:+y} pane=${TMUX_PANE:-none}"
fi

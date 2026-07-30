#!/usr/bin/env bash
# Turn THIS session's autonomy on/off via INTERACTION. The agent runs this when the user says
# "enable self-clear" / "go autonomous" (on), or "I'll manage this one" (off). It arms the current
# tmux PANE: self-clear becomes permitted, and post-/clear SessionStarts auto-catch-up + resume.
# Same marker claude-armed.sh uses, so launch-time and interaction-time arming are identical.
# Resolve the shared lib NEXT TO THIS SCRIPT so the repo copy is runnable/testable in place, and
# fall back to the installed location for a stray single-file copy. KIJITO_LC_LIB overrides both.
_kjt_lib="${KIJITO_LC_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lifecycle-lib.sh}"
[ -f "$_kjt_lib" ] || _kjt_lib="$HOME/.claude/lifecycle-lib.sh"
. "$_kjt_lib"
action="${1:-on}"
if [ -z "${TMUX_PANE:-}" ]; then echo "not in tmux — autonomy needs a tmux pane; nothing armed."; exit 1; fi
marker="$KIJITO_LC_DIR/arm.$TMUX_PANE"
case "$action" in
  on)     touch "$marker"; lc_log ARM "on pane=$TMUX_PANE"
          echo "AUTONOMY ON (pane $TMUX_PANE): self-clear permitted; after any /clear this pane auto-catches-up + resumes. Turn off: ~/.claude/arm-session.sh off" ;;
  off)    rm -f "$marker"; lc_log ARM "off pane=$TMUX_PANE"
          echo "AUTONOMY OFF (pane $TMUX_PANE): human-managed; self-clear refused." ;;
  status) if lc_is_armed "$TMUX_PANE"; then echo "armed (autonomous)"; else echo "not armed (human-managed)"; fi ;;
  *)      echo "usage: arm-session.sh [on|off|status]"; exit 2 ;;
esac

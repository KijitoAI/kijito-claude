#!/usr/bin/env bash
# Turn THIS session's autonomy on/off via INTERACTION. The agent runs this when the user says
# "enable self-clear" / "go autonomous" (on), or "I'll manage this one" (off). It arms the current
# tmux PANE: self-clear becomes permitted, and post-/clear SessionStarts auto-catch-up + resume.
# Same marker claude-armed.sh uses, so launch-time and interaction-time arming are identical.
. "$HOME/.claude/lifecycle-lib.sh"
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

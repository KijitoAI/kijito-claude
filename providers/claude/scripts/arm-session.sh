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
  # ⛔ `off` MUST NOT REPORT SUCCESS IT CANNOT DELIVER. Removing the marker disarms NOTHING while the
  # seat-wide KIJITO_AUTOCATCHUP=1 is in force, and a process cannot unset an env var for itself.
  # So: still remove the marker (that part is real and durable), then REFUSE LOUDLY and name the one
  # brake that works. Non-zero exit, so a caller that checks can tell it did not get what it asked.
  off)    rm -f "$marker"; lc_log ARM "off pane=$TMUX_PANE marker_removed"
          if lc_env_armed; then
            lc_log ARM "off REFUSED pane=$TMUX_PANE env=KIJITO_AUTOCATCHUP=1"
            cat >&2 <<EOF
⛔ STILL ARMED — 'off' COULD NOT DISARM THIS PANE.
   The marker $marker was removed, but arming is also granted seat-wide by
   KIJITO_AUTOCATCHUP=1 (set in the environment, typically ~/.claude/settings.json), and a
   running session cannot unset that for itself. self-clear is STILL PERMITTED here.
   The only brake that works:  touch $KIJITO_LC_STOP
   (undo with:                rm -f $KIJITO_LC_STOP )
EOF
            exit 3
          fi
          echo "AUTONOMY OFF (pane $TMUX_PANE): human-managed; self-clear refused." ;;
  # status prints BOTH inputs — a status that reports only the marker gives the wrong answer in
  # both directions on a seat where the env var is set.
  status) m=no; e=no
          lc_marker_armed "$TMUX_PANE" && m=yes
          lc_env_armed && e=yes
          echo "pane=$TMUX_PANE marker=$m (arm.$TMUX_PANE) env=$e (KIJITO_AUTOCATCHUP=${KIJITO_AUTOCATCHUP:-unset})"
          if lc_is_armed "$TMUX_PANE"; then
            echo "armed (autonomous) — armed by: $( [ "$m" = yes ] && printf 'marker '; [ "$e" = yes ] && printf 'env')"
            lc_stopped && echo "…but the kill switch is SET ($KIJITO_LC_STOP) — self-clear will refuse."
          else
            echo "not armed (human-managed)"
          fi
          exit 0 ;;   # status always exits 0 (it REPORTS; it does not assert). Read the text, not $?.
  *)      echo "usage: arm-session.sh [on|off|status]"; exit 2 ;;
esac

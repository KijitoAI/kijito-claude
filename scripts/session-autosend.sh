#!/usr/bin/env bash
# Delayed self-send of the catch-up prompt INTO a tmux pane → instigates the first turn.
# Called (detached, via nohup &) by the SessionStart hook ONLY when the pane is armed + in tmux.
# Args: $1 = target tmux pane (normally "$TMUX_PANE"). Fixed-delay approach — proven reliable.
# Needs Kijito: OPTIONAL — set KIJITO_AUTOCATCHUP_PROMPT for your own text, or KIJITO_MODE=off for a
#   generic (non-Kijito) default prompt.
set -u
. "$HOME/.claude/lifecycle-lib.sh"
pane="${1:?target pane required}"
command -v tmux >/dev/null 2>&1 || exit 0
lc_stopped && { lc_log AUTOSEND_SKIP "kill switch"; exit 0; }

if [ -n "${KIJITO_AUTOCATCHUP_PROMPT:-}" ]; then
  prompt="$KIJITO_AUTOCATCHUP_PROMPT"
elif [ "${KIJITO_MODE:-on}" = "off" ]; then
  # standalone (no Kijito): catch up against whatever notes/handoff you keep
  prompt="Catch up on this project's context and any handoff / next-steps notes from the prior session, then CONTINUE the active work to its DONE-WHEN without waiting for further instruction. If there's no active work, report ready."
else
  prompt="Please catch up deeply on all memories, lessons, and arm your inbox. If you are on a brand-new project with no persona yet, set that up per CLAUDE.md. Then, if your current-state / next-steps pointer shows ACTIVE WORK in progress, CONTINUE it autonomously without waiting for further instruction — work to its DONE-WHEN criteria, stopping only for a genuine gate. If there is no active work to resume, report ready."
fi

delay="${KIJITO_AUTOCATCHUP_DELAY:-4.0}"     # seconds for the TUI to become input-ready
sleep "$delay"
lc_stopped             && { lc_log AUTOSEND_ABORT "stop appeared"; exit 0; }
lc_pane_alive "$pane"  || { lc_log AUTOSEND_ABORT "pane gone"; exit 0; }
# NOTE: do NOT gate on pane_current_command — it's unreliable (reports "bash" for a wrapped
# claude, the version for an exec'd one). send-keys reaches the pane's TTY (claude) regardless.
tmux send-keys -t "$pane" -l -- "$prompt" 2>/dev/null
tmux send-keys -t "$pane" Enter 2>/dev/null
lc_log AUTOSEND_FIRE "delay=$delay"
exit 0

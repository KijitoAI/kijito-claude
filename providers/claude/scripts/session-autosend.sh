#!/usr/bin/env bash
# Delayed self-send of the catch-up prompt INTO a tmux pane → instigates the first turn.
# Called (detached, via nohup &) by the SessionStart hook ONLY when the pane is armed + in tmux.
# Args: $1 = target tmux pane (normally "$TMUX_PANE"). Fixed-delay approach — proven reliable.
# Needs Kijito: OPTIONAL — set KIJITO_AUTOCATCHUP_PROMPT for your own text, or KIJITO_MODE=off for a
#   generic (non-Kijito) default prompt.
set -u
# Resolve the shared lib NEXT TO THIS SCRIPT so the repo copy is runnable/testable in place, and
# fall back to the installed location for a stray single-file copy. KIJITO_LC_LIB overrides both.
_kjt_lib="${KIJITO_LC_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lifecycle-lib.sh}"
[ -f "$_kjt_lib" ] || _kjt_lib="$HOME/.claude/lifecycle-lib.sh"
. "$_kjt_lib"
pane="${1:?target pane required}"
command -v tmux >/dev/null 2>&1 || exit 0
lc_stopped && { lc_log AUTOSEND_SKIP "kill switch"; exit 0; }

if [ -n "${KIJITO_AUTOCATCHUP_PROMPT:-}" ]; then
  prompt="$KIJITO_AUTOCATCHUP_PROMPT"
elif [ "${KIJITO_MODE:-on}" = "off" ]; then
  # standalone (no Kijito): catch up against whatever notes/handoff you keep
  prompt="Catch up on this project's context and any handoff / next-steps notes from the prior session, then CONTINUE the active work to its DONE-WHEN without waiting for further instruction. If there's no active work, report ready."
else
  # Invoke the packaged catch-up routine (~/.claude/skills/kijito-start) by name — prose-invoked
  # rather than send-keys'ing a literal "/kijito-start" (the TUI slash-autocomplete menu is an
  # extra failure mode this path doesn't need). The skill covers catch-up + inbox-arm + new-persona
  # setup; the trailing directive carries the autonomous-resume mandate. (This prompt predated the
  # skill — updated 2026-07-10 per Jason.)
  prompt="Run the kijito-start skill (Skill: kijito-start) and follow it fully — catch up deeply on memory, arm the inbox, and if this is a brand-new project with no persona yet, set that up per CLAUDE.md. Then, if the current-state / next-steps pointer shows ACTIVE WORK in progress, CONTINUE it autonomously without waiting for further instruction — work to its DONE-WHEN criteria, stopping only for a genuine gate. If there is no active work to resume, report ready."
fi

delay="${KIJITO_AUTOCATCHUP_DELAY:-4.0}"     # seconds for the TUI to become input-ready
sleep "$delay"
lc_stopped             && { lc_log AUTOSEND_ABORT "stop appeared"; exit 0; }
lc_pane_alive "$pane"  || { lc_log AUTOSEND_ABORT "pane gone"; exit 0; }
# NOTE: do NOT gate on pane_current_command — it's unreliable (reports "bash" for a wrapped
# claude, the version for an exec'd one). send-keys reaches the pane's TTY (claude) regardless.
tmux send-keys -t "$pane" -l -- "$prompt" 2>/dev/null

# ⛔ THE ENTER NEEDS A GAP AFTER THE TEXT, AND WITHOUT ONE THE WHOLE AUTONOMOUS LOOP SILENTLY DIES.
# Observed 2026-08-01 (Jason, live): "the injected start prompt was just entered into the input but
# remained unsent." The two send-keys calls used to be back-to-back. The TUI is an Ink app that
# buffers a fast burst of characters as a PASTE, and an Enter arriving inside that burst is taken as
# a NEWLINE IN THE BUFFER rather than as submit. The prompt then sits in the input box, complete and
# unsent, forever.
#
# ★ WHY THIS IS THE WORST POSSIBLE PLACE FOR A SILENT FAILURE: this send is the ONLY thing that
# restarts work after a /clear. A self-clear with a broken re-send does not degrade the loop, it
# ENDS it — and it ends it in the state that looks most like success, because /clear ran, the pane
# is alive, and the prompt is visibly right there on screen.
settle="${KIJITO_SEND_SETTLE:-1.2}"          # let the TUI finish ingesting the paste
sleep "$settle"

# ⚠️ AND SENDING ENTER IS NOT THE SAME AS HAVING SENT THE PROMPT, so verify rather than hope.
# After a successful submit the input box is empty and the text has moved up into the transcript, so
# the prompt's TAIL disappears from the BOTTOM few lines. If it is still down there, the Enter did
# not take — retry a bounded number of times rather than leaving the loop dead.
#
# The probe is the prompt's LAST 40 characters: the tail is what remains visible in a wrapped input
# box, and matching a fixed string with -F avoids any regex metacharacter in the prompt.
probe=$(printf '%s' "$prompt" | tail -c 40)
sent=0
for _try in 1 2 3; do
  tmux send-keys -t "$pane" Enter 2>/dev/null
  sleep 1.5
  if ! tmux capture-pane -p -t "$pane" 2>/dev/null | tail -6 | grep -qF -- "$probe"; then
    sent=1; break
  fi
  lc_log AUTOSEND_RETRY "enter did not submit (attempt $_try)"
done

if [ "$sent" = 1 ]; then
  lc_log AUTOSEND_FIRE "delay=$delay settle=$settle"
else
  # Do not fail silently: a loop that stopped because of THIS is exactly what nobody notices.
  lc_log AUTOSEND_FAILED "prompt still in the input box after 3 Enters — the loop is NOT running"
fi
exit 0

#!/usr/bin/env bash
# AGENT-INVOKED self-/clear — the agent's FINAL action, only after /kijito-qa-memory passed.
# Hard gates (all must hold): kill-switch off · armed · not-a-subagent · in tmux · pane alive +
# is claude · FRESH qa-pass token · under cycle cap · not a checkpoint cycle. Never auto-fired.
set -u
. "$HOME/.claude/lifecycle-lib.sh"
refuse(){ echo "self-clear REFUSED: $1" >&2; lc_log SELFCLEAR_REFUSED "$1"; exit "${2:-3}"; }

lc_stopped && refuse "kill switch present ($KIJITO_LC_STOP) — rm it to re-enable" 9
lc_is_armed "${TMUX_PANE:-}" || refuse "not an armed pane — self-clear only runs in autonomous sessions (launch via ~/.claude/claude-armed.sh); plain 'claude' is human-managed" 3
lc_is_child && refuse "subagent marker set — would clear the PARENT pane" 6
{ [ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ]; } || refuse "not in tmux (TMUX/TMUX_PANE unset)" 4
lc_pane_alive "$TMUX_PANE" || refuse "target pane $TMUX_PANE no longer exists" 4
# (no pane_current_command gate — unreliable label; send-keys reaches the TTY regardless)

# C1 — require a FRESH /kijito-qa-memory pass for THIS session
tok="$(lc_qa_token)"; ttl="${KIJITO_QA_TTL:-1800}"
[ -f "$tok" ] || refuse "no kijito-qa-memory pass — run /kijito-qa-memory first (it cold-boot-verifies, then records the token)" 5
age=$(( $(lc_now) - $(cat "$tok" 2>/dev/null || echo 0) ))
[ "$age" -le "$ttl" ] || refuse "kijito-qa-memory pass is stale (${age}s > ${ttl}s) — re-run /kijito-qa-memory" 5

# C2 / H3 — cycle cap + periodic human checkpoint (count only genuine fires)
cf="$(lc_cycle_file)"; cyc=$(( $(cat "$cf" 2>/dev/null || echo 0) + 1 )); echo "$cyc" > "$cf"
max="${KIJITO_SELFCLEAR_MAX_CYCLES:-12}"
[ "$cyc" -le "$max" ] || refuse "cycle cap hit ($cyc > $max) — likely a loop; human review (reset: rm $cf)" 7
chk="${KIJITO_SELFCLEAR_CHECKPOINT:-5}"
if [ "$chk" -gt 0 ] && [ $(( cyc % chk )) -eq 0 ]; then
  refuse "checkpoint at cycle $cyc (every $chk) — pausing for human review; run again to continue past it" 8
fi

# C5 — consume the token (one clear per QA pass) and fire as the LAST action
rm -f "$tok"
delay="${KIJITO_SELFCLEAR_DELAY:-3.0}"
lc_log SELFCLEAR_FIRE "cycle=$cyc delay=$delay"
( sleep "$delay"
  lc_stopped               && { lc_log SELFCLEAR_ABORT "stop during delay"; exit 0; }
  lc_pane_alive "$TMUX_PANE" || { lc_log SELFCLEAR_ABORT "pane gone during delay"; exit 0; }
  tmux send-keys -t "$TMUX_PANE" -l -- "/clear" 2>/dev/null
  tmux send-keys -t "$TMUX_PANE" Enter 2>/dev/null
  lc_log SELFCLEAR_DONE "cycle=$cyc"
) >/dev/null 2>&1 &
echo "self-clear scheduled (cycle $cyc/$max): /clear → $TMUX_PANE in ${delay}s. This MUST be your FINAL action — stop now; SessionStart re-catches-up and resumes the preloaded work."
exit 0

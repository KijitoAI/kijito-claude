#!/usr/bin/env bash
# AGENT-INVOKED self-/clear — the agent's FINAL action, only after /kijito-qa-memory passed.
# Hard gates (all must hold): kill-switch off · armed · not-a-subagent · in tmux · pane alive ·
# FRESH qa-pass token. Never auto-fired. (Cycle cap + every-5 checkpoint REMOVED 2026-07-29 — see C2.)
set -u
# Resolve the shared lib NEXT TO THIS SCRIPT so the repo copy is runnable/testable in place, and
# fall back to the installed location for a stray single-file copy. KIJITO_LC_LIB overrides both.
_kjt_lib="${KIJITO_LC_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lifecycle-lib.sh}"
[ -f "$_kjt_lib" ] || _kjt_lib="$HOME/.claude/lifecycle-lib.sh"
. "$_kjt_lib"
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

# C2 — cycle COUNTER, telemetry only. NOT a gate.
#
# ⛔ REMOVED 2026-07-29 ON JASON'S EXPLICIT INSTRUCTION: the cycle cap (default 12)
# and the every-5 human checkpoint. Both were COUNT-based, and a count cannot
# distinguish a runaway loop from a productive day — it measures UPTIME.
#
# MEASURED over the whole log before removing (88 successful cycles, 24 refusals):
#     15  checkpoint at cycle N (every 5)   <- count-based, never caught a loop
#      4  cycle cap hit                     <- count-based, never caught a loop
#      3  kijito-qa-memory pass is stale    <- PROPERTY-based, genuinely useful
#      1  not an armed pane                 <- PROPERTY-based, genuinely useful
#      1  no kijito-qa-memory pass          <- PROPERTY-based, genuinely useful
# 19 of 24 refusals were the two count gates. Jason: "it's never once been useful,
# it's just gotten you to high context usage and blocked on something that isn't
# useful." Correct: they fired hardest on the most productive days, and the cost
# was a degraded session sitting at ~70% context waiting for a human to type rm.
#
# ★ THE REAL GATES ARE ALL STILL ABOVE and none of them is a counter: kill-switch,
# armed pane, not-a-subagent, in-tmux, pane alive, and a FRESH cold-boot-verified
# qa-pass token. Those check a PROPERTY of this clear ("is the handoff good enough
# to survive it?") rather than how many times it has happened before. A thin
# handoff still cannot self-clear, which is the protection that ever mattered.
#
# ⚠️ If a genuine runaway ever needs catching, detect the LOOP, not the count:
# consecutive cycles that land no commits and no memories. Do not reintroduce a
# counter — it is the same defect class as a stranded-mail check that measures
# broadcast cadence instead of neglect.
cf="$(lc_cycle_file)"; cyc=$(( $(cat "$cf" 2>/dev/null || echo 0) + 1 )); echo "$cyc" > "$cf"

# C5 — consume the token (one clear per QA pass) and fire as the LAST action
rm -f "$tok"
delay="${KIJITO_SELFCLEAR_DELAY:-3.0}"
lc_log SELFCLEAR_FIRE "cycle=$cyc delay=$delay"
( sleep "$delay"
  lc_stopped               && { lc_log SELFCLEAR_ABORT "stop during delay"; exit 0; }
  lc_pane_alive "$TMUX_PANE" || { lc_log SELFCLEAR_ABORT "pane gone during delay"; exit 0; }
  tmux send-keys -t "$TMUX_PANE" -l -- "/clear" 2>/dev/null
  # Same paste-buffer race that broke session-autosend (Jason, 2026-08-01: an injected prompt "was
  # entered into the input but remained unsent") — an Enter arriving inside the TUI's ingest burst is
  # taken as a newline rather than as submit. "/clear" is short and has fired ~88 times successfully,
  # so this gap is hardening, not a repair; but the cost of it failing here is the same dead loop.
  # ⛔ NO RETRY LOOP HERE, DELIBERATELY — THE OPPOSITE CHOICE FROM session-autosend. There a second
  # Enter is free. Here a second "/clear" would land in the session the first one already cleared,
  # wiping the auto-resume prompt the SessionStart hook had just injected — stopping the loop by way
  # of the very mechanism meant to protect it. Fire once.
  sleep "${KIJITO_SEND_SETTLE:-1.2}"
  tmux send-keys -t "$TMUX_PANE" Enter 2>/dev/null
  lc_log SELFCLEAR_DONE "cycle=$cyc"
) >/dev/null 2>&1 &
echo "self-clear scheduled (cycle $cyc, uncapped): /clear → $TMUX_PANE in ${delay}s. This MUST be your FINAL action — stop now; SessionStart re-catches-up and resumes the preloaded work."
exit 0

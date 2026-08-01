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
lc_is_child && refuse "subagent marker set — would clear the PARENT pane" 6
# ⚠️ THE TMUX CHECK MUST PRECEDE THE ARMED CHECK, AND THE ORDER USED TO BE REVERSED (argus, 2026-08-01).
# Outside tmux there is no TMUX_PANE, so lc_is_armed falls back to a placeholder and refuses with
# "not an armed pane — launch via claude-armed.sh". But arming is PANE-KEYED and arm-session.sh
# itself exits 1 outside tmux, so that refusal pointed at a remedy which cannot work. It is the
# familiar shape: COULD-NOT-MEASURE wearing the costume of THE-CLAIM-IS-FALSE. Ask the question
# that can actually be answered first.
{ [ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ]; } || refuse "not in tmux (TMUX/TMUX_PANE unset)" 4
lc_pane_alive "$TMUX_PANE" || refuse "target pane $TMUX_PANE no longer exists" 4
lc_is_armed "${TMUX_PANE:-}" || refuse "not an armed pane — self-clear only runs in autonomous sessions (launch via ~/.claude/claude-armed.sh, or ~/.claude/arm-session.sh on); plain 'claude' is human-managed" 3
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

# C6 — RECORD THE CONTEXT LEVEL WE RECYCLED AT. OBSERVABILITY, NOT A GATE.
# ⛔ THE RULE IS NUMERIC AND WE WERE RECORDING NO INSTANCE OF THE NUMBER. `lifecycle.log` could
# say THAT a seat recycled and WHEN, but not whether it went at 20% or 78% — so "does the fleet
# actually recycle near the target?" was unanswerable, including retrospectively. You could not
# spot a seat looping at 15%, nor one running to 80% and doing its worst work in the tail.
# (Found by ladybug 2026-08-01 while auditing the myctx residual; this also gives myctx's
# non-zero exit its first real consumer — until now its only "consumer" was a sentence of prose
# telling an agent to run it.)
#
# ⛔ AND IT IS DELIBERATELY NOT A GATE, which is the more important half. The obvious version —
# "refuse to self-clear when context is UNMEASURABLE" — makes jq, $CLAUDE_CODE_SESSION_ID and a
# readable transcript into three new fleet-wide halt conditions for the autonomous loop. That is
# a STRICTLY LARGER outage than the risk it removes. ★ The blast radius a new gate on this path
# may have is "can stop ONE cycle"; that one is "can stop EVERY cycle on EVERY seat". ladybug
# proposed it against their own instinct for exactly this reason, hours after nearly shipping
# `lc_is_child` — a real defect with an invented fix that would have refused forever.
#
# ✅ THE CAVEAT THEY FLAGGED IS RESOLVED BY MEASUREMENT, NOT BY ARGUMENT: myctx inside a SUBAGENT
# reports the PARENT's context (a real number about the wrong subject), so this would be worse
# than useless if this script ran in a different session context than the pane's agent. Verified
# 2026-08-01 on the VM: the shell this script runs in resolves the same CLAUDE_CODE_SESSION_ID as
# the pane's agent, and myctx there returned 32.2% / ~677557 free against the agent's own live
# counter of 677261 remaining — agreement to ~300 tokens, which is just the tokens spent between
# the two reads. ⚠️ A WRONG number in an audit log is worse than an absent one, so if this ever
# moves to a different execution context, RE-MEASURE that agreement before trusting the field.
ctx="UNMEASURABLE"
# KIJITO_MYCTX exists so the SUCCESS branch is testable. Without it a test can only ever exercise
# the failure path (a fixture session has no transcript), and a branch that is only ever tested in
# the direction it fails is not tested — the exact defect that let lc_pane_alive return TRUE for
# every input for months.
_myctx="${KIJITO_MYCTX:-$HOME/.claude/myctx.sh}"
if [ -x "$_myctx" ]; then
  _m=$("$_myctx" 2>/dev/null) && case "$_m" in
    *%*) ctx=$(printf '%s' "$_m" | sed -n 's/.*= *\([0-9.]*%\).*/\1/p'); [ -n "$ctx" ] || ctx="UNPARSED" ;;
  esac
fi
lc_log SELFCLEAR_FIRE "cycle=$cyc delay=$delay ctx=$ctx"
( sleep "$delay"
  lc_stopped               && { lc_log SELFCLEAR_ABORT "stop during delay"; exit 0; }
  lc_pane_alive "$TMUX_PANE" || { lc_log SELFCLEAR_ABORT "pane gone during delay"; exit 0; }
  # ⛔ BRANCH ON DELIVERY. `SELFCLEAR_DONE` used to be logged UNCONDITIONALLY, with both send-keys
  # calls discarding stderr and nothing reading their status — so a REFUSED delivery still wrote
  # DONE (argus, 2026-08-01). An audit log asserting an action that did not occur is the one thing
  # an audit log must never do, and it chained with the decorative lc_pane_alive: gate passes,
  # delivery fails, log says DONE, token is consumed — the loop believes it recycled and did not.
  #
  # ★ THE TWO FAILURES ARE LOGGED SEPARATELY ON PURPOSE: "not typed" and "typed but not submitted"
  # are different states with different causes, and the second is exactly what Jason observed for
  # session-autosend. Collapsing them would hide the one the settle-sleep below addresses.
  if tmux send-keys -t "$TMUX_PANE" -l -- "/clear" 2>/dev/null; then
    # Same paste-buffer race that broke session-autosend — an Enter arriving inside the TUI's ingest
    # burst is taken as a newline rather than as submit. "/clear" is short and has fired ~88 times
    # successfully, so this gap is hardening rather than a repair; the cost of failing here is the
    # same dead loop.
    # ⛔ NO RETRY LOOP, DELIBERATELY — THE OPPOSITE CHOICE FROM session-autosend. There a second
    # Enter is free. Here a second "/clear" would land in the session the first already cleared,
    # wiping the auto-resume prompt the SessionStart hook had just injected — stopping the loop by
    # way of the very mechanism meant to protect it. Fire once.
    sleep "${KIJITO_SEND_SETTLE:-1.2}"
    if tmux send-keys -t "$TMUX_PANE" Enter 2>/dev/null; then
      lc_log SELFCLEAR_DONE "cycle=$cyc"
    else
      lc_log SELFCLEAR_FAILED "cycle=$cyc Enter refused pane=$TMUX_PANE — /clear typed, NOT submitted"
    fi
  else
    lc_log SELFCLEAR_FAILED "cycle=$cyc send-keys refused pane=$TMUX_PANE — NOT cleared"
  fi
) >/dev/null 2>&1 &
echo "self-clear scheduled (cycle $cyc, uncapped): /clear → $TMUX_PANE in ${delay}s. This MUST be your FINAL action — stop now; SessionStart re-catches-up and resumes the preloaded work."
exit 0

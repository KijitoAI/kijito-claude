#!/usr/bin/env bash
# Comprehensive test of the hardened lifecycle scripts. Isolated state; stand-in tmux panes.
# Arming model: per-pane marker (claude-armed.sh) OR KIJITO_AUTOCATCHUP=1. Self-clear uses lc_is_armed.
set -u
unset KIJITO_AUTOCATCHUP 2>/dev/null   # this shell may have it lingering; don't let it pollute tests
LCT="/tmp/lctest.$$"; rm -rf "$LCT"; mkdir -p "$LCT"
export KIJITO_LC_DIR="$LCT" CLAUDE_CODE_SESSION_ID=testsess KIJITO_LC_TEST=1
LIB=~/.claude/lifecycle-lib.sh; SC=~/.claude/self-clear.sh; QP=~/.claude/kijito-qa-pass.sh; AS=~/.claude/session-autosend.sh
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS: $1 (exit $3)"; pass=$((pass+1)); else echo "  FAIL: $1 (want $2 got $3)"; fail=$((fail+1)); fi; }
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }

echo "== syntax =="
for f in "$LIB" "$SC" "$QP" "$AS" ~/.claude/session-catchup-hint.sh ~/.claude/myctx.sh ~/.claude/statusline-context.sh ~/.claude/claude-armed.sh; do
  bash -n "$f" && echo "  ok $(basename "$f")" || no "syntax $(basename "$f")"; done

echo "== self-clear refusals (no tmux) =="
( unset TMUX TMUX_PANE; bash "$SC" >/dev/null 2>&1 ); chk "not-armed (plain session)" 3 $?
( unset TMUX TMUX_PANE; KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1 ); chk "armed but no-tmux" 4 $?
( unset TMUX TMUX_PANE; touch "$LCT/STOP"; KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1; r=$?; rm -f "$LCT/STOP"; exit $r ); chk "kill-switch" 9 $?
( unset TMUX TMUX_PANE; CLAUDE_AGENT_TYPE=x KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1 ); chk "subagent-marker" 6 $?

echo "== stand-in tmux panes (armed via marker) =="
S=lc_sc_test; tmux kill-session -t $S 2>/dev/null; tmux new-session -d -s $S "bash --norc -i"; sleep 0.4
RS=$(tmux display-message -p '#{socket_path}'); TM="$RS,0,0"
touch "$LCT/arm.$S"     # simulate claude-armed.sh marker for this pane

KIJITO_AUTOCATCHUP=1 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1; chk "armed,tmux,no-token" 5 $?
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1   # writes token for testsess
CLAUDE_CODE_SESSION_ID=testsess KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_DELAY=0.4 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1; chk "armed+token FIRES" 0 $?
sleep 1.0
tmux capture-pane -t $S -p | grep -q "/clear" && ok "/clear delivered to pane" || no "/clear not in pane"
[ -f "$LCT/qa-pass.testsess" ] && no "token NOT consumed" || ok "token consumed"
KIJITO_AUTOCATCHUP=1 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1; chk "no reuse without fresh token" 5 $?

echo "== cycle cap (max=2, checkpoint off) — pane-keyed =="
rm -f "$LCT"/cycles.*
for i in 1 2; do KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1; \
  KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_MAX_CYCLES=2 KIJITO_SELFCLEAR_CHECKPOINT=0 KIJITO_SELFCLEAR_DELAY=0.1 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1; done
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_MAX_CYCLES=2 KIJITO_SELFCLEAR_CHECKPOINT=0 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1; chk "cycle cap exceeded" 7 $?

echo "== checkpoint (every 2) =="
rm -f "$LCT"/cycles.*
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_CHECKPOINT=2 KIJITO_SELFCLEAR_MAX_CYCLES=99 KIJITO_SELFCLEAR_DELAY=0.1 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1  # cycle1 fires
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_CHECKPOINT=2 KIJITO_SELFCLEAR_MAX_CYCLES=99 TMUX="$TM" TMUX_PANE="$S" bash "$SC" >/dev/null 2>&1; chk "checkpoint at cycle 2" 8 $?

echo "== pane-keyed cycle persists across sid change (the /clear-rotates-sid fix) =="
rm -f "$LCT"/cycles.*
CLAUDE_CODE_SESSION_ID=sidA TMUX_PANE="$S" bash -c '. '"$LIB"'; echo 3 > "$(lc_cycle_file)"'
v=$(CLAUDE_CODE_SESSION_ID=sidB TMUX_PANE="$S" bash -c '. '"$LIB"'; cat "$(lc_cycle_file)"')
[ "$v" = "3" ] && ok "cycle count survives sid change (pane-keyed)" || no "cycle reset on sid change (got $v)"

echo "== autosend delivers (no pane-usable guard) =="
S2=lc_as_test; tmux kill-session -t $S2 2>/dev/null
tmux new-session -d -s $S2 "bash --norc -i -c 'echo READY; IFS= read -r l; printf %s \"\$l\" > $LCT/as.out; sleep 1'"; sleep 0.5
KIJITO_AUTOCATCHUP_DELAY=0.5 KIJITO_AUTOCATCHUP_PROMPT='AS_TEST_123' bash "$AS" "$S2"; sleep 1.2
grep -qx 'AS_TEST_123' "$LCT/as.out" 2>/dev/null && ok "autosend delivered" || no "autosend delivery"

echo "== kill switch blocks autosend =="
touch "$LCT/STOP"; rm -f "$LCT/as.out"
tmux kill-session -t $S2 2>/dev/null; tmux new-session -d -s $S2 "bash --norc -i -c 'IFS= read -r l; printf %s \"\$l\" > $LCT/as.out; sleep 1'"; sleep 0.3
KIJITO_AUTOCATCHUP_DELAY=0.3 KIJITO_AUTOCATCHUP_PROMPT='SHOULD_NOT_SEND' bash "$AS" "$S2"; sleep 0.6
[ -s "$LCT/as.out" ] && no "autosend fired despite STOP" || ok "STOP blocked autosend"
rm -f "$LCT/STOP"

echo "== audit log =="
[ -s "$LCT/lifecycle.log" ] && ok "log has entries" || no "no audit log"

tmux kill-session -t $S 2>/dev/null; tmux kill-session -t $S2 2>/dev/null; rm -rf "$LCT"
echo; echo "RESULT: $pass passed, $fail failed"; [ "$fail" -eq 0 ]

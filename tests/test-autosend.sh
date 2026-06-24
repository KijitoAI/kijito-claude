#!/usr/bin/env bash
# Mechanical end-to-end test of the armed auto-send chain WITHOUT launching real claude.
# Stand-in: a tmux pane running an interactive bash that prints READY, reads ONE line,
# and records it. Proves: delay → literal prompt typed → Enter submits → program receives
# exactly the prompt. (The ONLY thing this can't test is the real claude TUI's input-ready
# delay; tune KIJITO_AUTOCATCHUP_DELAY against a live `claude` for that.)
set -u
S=kijito_autosend_test
out="/tmp/${S}.out.$$"; rm -f "$out"
tmux kill-session -t "$S" 2>/dev/null
tmux new-session -d -s "$S" "bash --norc -i -c 'echo READY; IFS= read -r l; printf %s \"\$l\" > $out; sleep 1'"
sleep 0.5
echo "→ simulating ARMED SessionStart auto-send into stand-in pane '$S'"
KIJITO_AUTOCATCHUP_DELAY=0.5 KIJITO_AUTOCATCHUP_PROMPT='CATCHUP_TEST_PROMPT_123' \
  bash "$HOME/.claude/session-autosend.sh" "$S"
sleep 1.3
echo "--- pane contents ---"; tmux capture-pane -t "$S" -p 2>/dev/null | grep -v '^$' | tail -3
echo "--- line the program actually received ---"; cat "$out" 2>/dev/null; echo
tmux kill-session -t "$S" 2>/dev/null
if grep -qx 'CATCHUP_TEST_PROMPT_123' "$out" 2>/dev/null; then
  echo "PASS: prompt delivered AND submitted (turn would be instigated)"; rm -f "$out"; exit 0
else
  echo "FAIL: prompt not delivered/submitted"; rm -f "$out"; exit 1
fi

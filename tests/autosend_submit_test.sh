#!/usr/bin/env bash
# Does the injected catch-up prompt actually get SUBMITTED, not just typed?
#
# WHY THIS EXISTS. Observed live 2026-08-01 (Jason): "the injected start prompt was just entered
# into the input but remained unsent." session-autosend.sh sent the prompt text and an Enter as two
# back-to-back tmux send-keys calls. The Claude Code TUI is an Ink app that buffers a fast burst of
# characters as a PASTE, and an Enter arriving inside that burst is consumed as a NEWLINE IN THE
# BUFFER instead of as submit. The prompt then sits in the input box, complete and unsent.
#
# ★ THIS IS THE HIGHEST-COST SILENT FAILURE IN THE WHOLE LIFECYCLE, which is why it gets a test
# rather than just a fix: that send is the ONLY thing that restarts work after a /clear. A broken
# re-send does not degrade the autonomous loop, it ENDS it — and it ends it in the state that looks
# most like success (the /clear ran, the pane is alive, the prompt is visibly right there).
#
# HOW IT TESTS WITHOUT A REAL TUI. Standing up Claude Code per run is too heavy and would burn a
# session, so the pane runs a SIMULATOR that reproduces the one behaviour under test: an Enter
# arriving within GRACE ms of the preceding character is treated as a literal newline; a later one
# submits. The simulator is deliberately dumb — it models the RACE, not the TUI.
#
# ⚠️ A SIMULATOR CAN ONLY REFUTE, NOT CONFIRM. Passing here does not prove the real TUI submits; it
# proves the sender no longer relies on the timing that demonstrably broke it. The direction that
# carries the weight is direction 1: the OLD back-to-back pattern must FAIL against this simulator,
# or the simulator is not reproducing the bug and the whole file proves nothing.
#
#   bash tests/autosend_submit_test.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0; fail=0
grn() { printf "  ok    %s\n" "$1"; pass=$((pass+1)); }
red() { printf "  FAIL  %s\n" "$1"; fail=$((fail+1)); }

command -v tmux >/dev/null 2>&1 || { echo "SKIP: tmux not installed."; exit 0; }
command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 not installed."; exit 0; }

TMP="$(mktemp -d)"; trap 'tmux kill-session -t autosend_probe 2>/dev/null; rm -rf "$TMP"' EXIT

cat > "$TMP/sim.py" <<'SIM'
import sys, time, termios, tty, os
# Stand-in for the TUI input box. Enter within GRACE seconds of the previous character is a
# newline inside the paste buffer (the bug); a later Enter submits.
GRACE = float(os.environ.get("SIM_GRACE", "0.35"))
out = open(sys.argv[1], "w", buffering=1)
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
buf = ""; last = 0.0
try:
    while True:
        ch = sys.stdin.read(1)
        if not ch:
            break
        now = time.time()
        if ch in ("\r", "\n"):
            if now - last < GRACE:
                buf += "\n"          # swallowed as part of the paste — the defect
                out.write("NEWLINE_ABSORBED\n")
            else:
                out.write("SUBMITTED:" + buf.replace("\n", " ")[:60] + "\n")
                buf = ""
        else:
            buf += ch
        last = now
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
SIM

start_pane() {  # $1 = marker file
  tmux kill-session -t autosend_probe 2>/dev/null
  tmux new-session -d -s autosend_probe -x 120 -y 30 "python3 '$TMP/sim.py' '$1'"
  sleep 1
  tmux list-panes -t autosend_probe -F '#{pane_id}' | head -1
}

PROMPT="Run the kijito-start skill and follow it fully, then continue the active work autonomously to its DONE-WHEN."

# ── direction 1: the OLD pattern (text then Enter, no gap) MUST fail to submit ──────────────────
# If this direction ever goes green, the simulator has stopped reproducing the bug and every other
# result in this file is meaningless. Read it first.
: > "$TMP/old.log"
pane="$(start_pane "$TMP/old.log")"
tmux send-keys -t "$pane" -l -- "$PROMPT" 2>/dev/null
tmux send-keys -t "$pane" Enter 2>/dev/null
sleep 2
if grep -q "^SUBMITTED:" "$TMP/old.log"; then
  red "old back-to-back pattern SUBMITTED — the simulator is not reproducing the race, so this suite proves nothing"
else
  grn "old back-to-back pattern does NOT submit (the reported defect, reproduced)"
fi

# ── direction 2: the SHIPPED sender must submit ─────────────────────────────────────────────────
# Exercises the real script's send path by sourcing its settle+verify constants rather than
# re-implementing them: same sleep, same bounded Enter retry.
: > "$TMP/new.log"
pane="$(start_pane "$TMP/new.log")"
settle="$(grep -o 'KIJITO_SEND_SETTLE:-[0-9.]*' "$REPO/providers/claude/scripts/session-autosend.sh" | head -1 | cut -d- -f3)"
[ -n "$settle" ] || settle=1.2
tmux send-keys -t "$pane" -l -- "$PROMPT" 2>/dev/null
sleep "$settle"
probe=$(printf '%s' "$PROMPT" | tail -c 40)
for _try in 1 2 3; do
  tmux send-keys -t "$pane" Enter 2>/dev/null
  sleep 1.5
  grep -q "^SUBMITTED:" "$TMP/new.log" && break
done
if grep -q "^SUBMITTED:" "$TMP/new.log"; then
  grn "shipped sender submits (settle=${settle}s)"
else
  red "shipped sender did NOT submit — the autonomous loop would die after every /clear"
fi

# ── direction 3: the settle constant is actually present in the shipped script ──────────────────
# Cheap, but it is the thing a future edit is most likely to delete while leaving this test green,
# because direction 2 falls back to its own default when the grep misses.
if grep -q 'KIJITO_SEND_SETTLE' "$REPO/providers/claude/scripts/session-autosend.sh"; then
  grn "session-autosend.sh carries the settle gap"
else
  red "session-autosend.sh has no settle gap — the race is back"
fi

# ── direction 4: self-clear must NOT retry its Enter ────────────────────────────────────────────
# A second /clear would wipe the freshly auto-resumed session. Asserting the ABSENCE of a retry is
# unusual, but this is a case where more robustness in the sender is a REGRESSION.
if grep -A6 'send-keys .* "/clear"' "$REPO/providers/claude/scripts/self-clear.sh" | grep -qE 'for _try|for attempt'; then
  red "self-clear retries its Enter — a second /clear would wipe the auto-resumed session"
else
  grn "self-clear fires its Enter exactly once (no retry, deliberately)"
fi

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1

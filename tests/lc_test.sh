#!/usr/bin/env bash
# Comprehensive test of the hardened lifecycle scripts. Isolated state; stand-in tmux panes.
# Arming model: per-pane marker (claude-armed.sh) OR KIJITO_AUTOCATCHUP=1. Self-clear uses lc_is_armed.
set -u
unset KIJITO_AUTOCATCHUP 2>/dev/null   # this shell may have it lingering; don't let it pollute tests
LCT="/tmp/lctest.$$"; rm -rf "$LCT"; mkdir -p "$LCT"
export KIJITO_LC_DIR="$LCT" CLAUDE_CODE_SESSION_ID=testsess KIJITO_LC_TEST=1
# ── WHICH COPY IS UNDER TEST (this used to be hardcoded to ~/.claude, and that was the bug) ──
# The suite tested the INSTALLED scripts, never the ones this repo ships. So the repo could pass
# while shipping something else entirely, and repo-vs-install drift was invisible to it: on
# 2026-07-29 four of nine scripts had drifted (install AHEAD by 3 days to 5 weeks) and the suite
# reported red — against the repo's own tests, for a change made only to the install.
# Default is now the REPO copy, i.e. the thing that actually ships. Set KIJITO_TEST_TARGET=installed
# to exercise ~/.claude instead (what your machine is really running); tests/drift_test.sh reports
# when the two disagree.
SDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../providers/claude/scripts" && pwd)"
if [ "${KIJITO_TEST_TARGET:-repo}" = "installed" ]; then SDIR="$HOME/.claude"; fi
echo "== target: ${KIJITO_TEST_TARGET:-repo} ($SDIR) =="
LIB="$SDIR/lifecycle-lib.sh"; SC="$SDIR/self-clear.sh"; QP="$SDIR/kijito-qa-pass.sh"; AS="$SDIR/session-autosend.sh"
# The scripts resolve their own lib next to themselves; pin it so a repo run can never silently
# source the installed lib (the exact confusion this block exists to end).
export KIJITO_LC_LIB="$LIB"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS: $1 (exit $3)"; pass=$((pass+1)); else echo "  FAIL: $1 (want $2 got $3)"; fail=$((fail+1)); fi; }
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }

echo "== syntax =="
for f in "$LIB" "$SC" "$QP" "$AS" ~/.claude/session-catchup-hint.sh ~/.claude/myctx.sh ~/.claude/statusline-context.sh ~/.claude/claude-armed.sh; do
  bash -n "$f" && echo "  ok $(basename "$f")" || no "syntax $(basename "$f")"; done

echo "== self-clear refusals (no tmux) =="
# ⚠️ EXPECTATION CHANGED 2026-08-01 WITH THE GATE REORDER (argus D3), AND THE OLD ONE WAS THE BUG.
# Outside tmux this used to refuse 3 ("not an armed pane — launch via claude-armed.sh"), but arming
# is PANE-KEYED and arm-session.sh itself exits 1 outside tmux, so that refusal named a remedy which
# cannot work: could-not-measure wearing the costume of the-claim-is-false. The tmux check now runs
# first, so the honest answer outside tmux is 4. The genuine not-armed case is exercised below,
# inside a real pane, where the question can actually be answered.
( unset TMUX TMUX_PANE; bash "$SC" >/dev/null 2>&1 ); chk "no tmux beats not-armed (honest refusal)" 4 $?
( unset TMUX TMUX_PANE; KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1 ); chk "armed but no-tmux" 4 $?
( unset TMUX TMUX_PANE; touch "$LCT/STOP"; KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1; r=$?; rm -f "$LCT/STOP"; exit $r ); chk "kill-switch" 9 $?
( unset TMUX TMUX_PANE; CLAUDE_AGENT_TYPE=x KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1 ); chk "subagent-marker" 6 $?

echo "== stand-in tmux panes (armed via marker) =="
# ⛔ THIS USED TO PASS A SESSION NAME AS TMUX_PANE, AND ONLY WORKED BECAUSE THE GATE WAS BROKEN.
# `lc_pane_alive` read the exit code of `tmux display-message`, which is 0 even for a nonexistent
# pane, so ANY string satisfied it — including "lc_sc_test". Now that the gate enumerates real pane
# ids (argus D1), a session name is correctly rejected. The fixture was also unfaithful: production
# passes $TMUX_PANE, which is always a pane id like "%42", never a session name.
# ★ The old fixture could not have caught the defect it was standing on — it fed the gate the one
# kind of value that made a broken gate look correct.
S=lc_sc_test; tmux kill-session -t $S 2>/dev/null; tmux new-session -d -s $S "bash --norc -i"; sleep 0.4
RS=$(tmux display-message -p '#{socket_path}'); TM="$RS,0,0"
P=$(tmux list-panes -t $S -F '#{pane_id}' | head -1)     # the REAL pane id, as production supplies
[ -n "$P" ] || { echo "FATAL: could not resolve a pane id for session $S"; exit 2; }
# ⛔ NOT `touch` any more. A zero-byte marker is exactly the defect: it cannot prove it belongs to
# THIS session, and pane ids recycle. The fixture must write what production writes, or it tests a
# marker format that no longer arms anything.
KIJITO_LC_DIR="$LCT" bash -c ". '$LIB'; lc_marker_write '$P'" || { echo "FATAL: fixture could not stamp an arm marker"; exit 2; }

# The genuine not-armed refusal, which the no-tmux case above can no longer reach: a REAL live pane
# with no arm marker and no KIJITO_AUTOCATCHUP must refuse 3.
( TMUX="$TM" TMUX_PANE="$P" KIJITO_LC_DIR="$LCT/unarmed" bash "$SC" >/dev/null 2>&1 ); chk "live pane, not armed" 3 $?

# And the gate that had never once refused: a well-formed but DEAD pane id must be rejected.
( TMUX="$TM" TMUX_PANE="%99999" KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1 ); chk "dead pane id refused" 4 $?
( TMUX="$TM" TMUX_PANE="not-a-pane" KIJITO_AUTOCATCHUP=1 bash "$SC" >/dev/null 2>&1 ); chk "malformed pane refused" 4 $?

KIJITO_AUTOCATCHUP=1 TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "armed,tmux,no-token" 5 $?
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1   # writes token for testsess
CLAUDE_CODE_SESSION_ID=testsess KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_DELAY=0.4 TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "armed+token FIRES" 0 $?
sleep 1.0
tmux capture-pane -t $S -p | grep -q "/clear" && ok "/clear delivered to pane" || no "/clear not in pane"
[ -f "$LCT/qa-pass.testsess" ] && no "token NOT consumed" || ok "token consumed"
KIJITO_AUTOCATCHUP=1 TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "no reuse without fresh token" 5 $?

# ── THE CYCLE CAP + EVERY-N CHECKPOINT TESTS WERE REMOVED HERE, DELIBERATELY. DO NOT RESTORE. ──
# Both gates were deleted from self-clear.sh on 2026-07-29 on Jason's explicit instruction, with the
# measurement recorded at the removal site (self-clear.sh "C2"): over 88 successful cycles and 24
# refusals, 19 of the 24 were those two COUNT gates, and neither ever caught a loop. A count cannot
# distinguish a runaway loop from a productive day, because it measures uptime.
#
# ⚠️ These two assertions then OUTLIVED the contract they tested, and a later session read the
# resulting red as "the runaway-loop backstop is broken in a published package" and came close to
# re-introducing the counter Jason had just ordered removed. A deliberate removal and a regression
# look IDENTICAL at the test boundary — so the note lives here, next to the assertions, where a
# reader arriving from a failure will actually be standing.
#
# ⛔ If a genuine runaway ever needs catching, assert the LOOP, not the count: consecutive cycles
# landing no commits and no memories. Do not add a counter assertion back.
#
# What replaces them below is the property that ever did the protecting: a clear requires a FRESH
# cold-boot-verified handoff token, so a thin or stale handoff cannot self-clear.

echo "== self-clear is gated on handoff FRESHNESS, not on a cycle count =="
rm -f "$LCT"/cycles.*
# A STALE token must refuse (exit 5) even though every other gate passes — this is the real backstop.
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
tok_dir="$LCT"; stale=$(( $(date +%s) - 99999 ))
for f in "$tok_dir"/qa-pass.*; do [ -f "$f" ] && echo "$stale" > "$f"; done
KIJITO_AUTOCATCHUP=1 KIJITO_QA_TTL=1800 TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "stale handoff refused" 5 $?
# And a FRESH token fires, proving the gate discriminates rather than always refusing (both
# directions — a gate that only ever refuses is not a gate, it is an outage).
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
KIJITO_AUTOCATCHUP=1 KIJITO_QA_TTL=1800 KIJITO_SELFCLEAR_DELAY=0.1 TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "fresh handoff fires" 0 $?

echo "== the cap is GONE: many consecutive cycles are permitted (regression guard on the removal) =="
rm -f "$LCT"/cycles.*
capfail=0
for i in 1 2 3 4 5 6 7; do
  KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
  KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_DELAY=0.05 TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1 || capfail=$?
done
[ "$capfail" -eq 0 ] && ok "7 consecutive cycles all fired (no count gate)" || no "a count gate refused at cycle >=1 (exit $capfail) — the cap was reintroduced"

echo "== pane-keyed cycle persists across sid change (the /clear-rotates-sid fix) =="
rm -f "$LCT"/cycles.*
CLAUDE_CODE_SESSION_ID=sidA TMUX_PANE="$S" bash -c '. '"$LIB"'; echo 3 > "$(lc_cycle_file)"'
v=$(CLAUDE_CODE_SESSION_ID=sidB TMUX_PANE="$S" bash -c '. '"$LIB"'; cat "$(lc_cycle_file)"')
[ "$v" = "3" ] && ok "cycle count survives sid change (pane-keyed)" || no "cycle reset on sid change (got $v)"

echo "== autosend delivers (no pane-usable guard) =="
# ⚠️ TIMING AND TARGET BOTH UPDATED 2026-08-01. The sender now waits KIJITO_SEND_SETTLE (1.2s) before
# the Enter and then verifies with up to 3 x 1.5s probes, so the old `sleep 1.2` checked the output
# file BEFORE delivery could possibly have happened — a fixture that fails an implementation which
# works. The fixture's own `sleep 1` also killed the pane mid-verify. Target is now a real pane id,
# matching production and the corrected fixtures above.
# ⚠️ In THIS fixture the verify probe necessarily under-reports: a plain interactive shell echoes the
# typed line and leaves it on screen, so the sender will log AUTOSEND_UNCONFIRMED even on a delivery
# that demonstrably worked. That is why the assertion below reads the DELIVERED FILE — the ground
# truth — rather than the sender's own confidence.
S2=lc_as_test; tmux kill-session -t $S2 2>/dev/null
tmux new-session -d -s $S2 "bash --norc -i -c 'echo READY; IFS= read -r l; printf %s \"\$l\" > $LCT/as.out; sleep 30'"; sleep 0.5
P2=$(tmux list-panes -t $S2 -F '#{pane_id}' | head -1)
KIJITO_AUTOCATCHUP_DELAY=0.5 KIJITO_AUTOCATCHUP_PROMPT='AS_TEST_123' bash "$AS" "$P2"; sleep 1.0
grep -qx 'AS_TEST_123' "$LCT/as.out" 2>/dev/null && ok "autosend delivered" || no "autosend delivery"

echo "== kill switch blocks autosend =="
touch "$LCT/STOP"; rm -f "$LCT/as.out"
tmux kill-session -t $S2 2>/dev/null; tmux new-session -d -s $S2 "bash --norc -i -c 'IFS= read -r l; printf %s \"\$l\" > $LCT/as.out; sleep 1'"; sleep 0.3
KIJITO_AUTOCATCHUP_DELAY=0.3 KIJITO_AUTOCATCHUP_PROMPT='SHOULD_NOT_SEND' bash "$AS" "$S2"; sleep 0.6
[ -s "$LCT/as.out" ] && no "autosend fired despite STOP" || ok "STOP blocked autosend"
rm -f "$LCT/STOP"

echo "== arm markers carry PROVENANCE — an inherited marker must not arm a session =="
# ★ THE CASE THAT MATTERS IS THE THIRD ONE. ladybug found 13 stale `arm.*` markers on the Mac with
# `arm.%2` matching a LIVE UNRELATED pane: markers are never GC'd and tmux pane ids restart at %0
# and recycle, so a fresh session on a low-numbered pane silently inherits an arming performed weeks
# ago by another agent — on the gate that authorises an IRREVERSIBLE /clear. A zero-byte file cannot
# distinguish those cases; a recorded session fingerprint can, and it is re-derived from the live
# tmux server on every read rather than trusted from disk.
_armed() { KIJITO_LC_DIR="$1" bash -c ". '$LIB'; lc_marker_armed '$2'"; }
PROV="$LCT/prov"; mkdir -p "$PROV"

KIJITO_LC_DIR="$PROV" bash -c ". '$LIB'; lc_marker_write '$P'"
_armed "$PROV" "$P" && ok "a marker written for THIS live session arms it" || no "provenance marker did not arm"

: > "$PROV/arm.$P"      # legacy: exists, zero bytes, no provenance
_armed "$PROV" "$P" && no "a LEGACY zero-byte marker still arms (fail-open)" || ok "a legacy zero-byte marker does NOT arm (fail closed)"

# The inheritance case: a well-formed marker for this pane id, stamped by a DIFFERENT session
# instance. Same pane id, same session NAME — only #{session_created} differs, which is precisely
# what a tmux server restart or a kill-and-recreate produces.
KIJITO_LC_DIR="$PROV" bash -c ". '$LIB'; lc_marker_write '$P'"
awk -F= '$1=="session_created"{print "session_created=1"; next} {print}' "$PROV/arm.$P" > "$PROV/tmp" && mv "$PROV/tmp" "$PROV/arm.$P"
_armed "$PROV" "$P" && no "an INHERITED marker (recycled pane id) still arms — the hazard is live" \
                    || ok "an inherited marker (stale session fingerprint) does NOT arm"

# And a marker for a pane that does not exist can never arm, however well-formed.
KIJITO_LC_DIR="$PROV" bash -c ". '$LIB'; lc_marker_write '%99999'" && no "wrote a marker for a dead pane" || ok "refuses to stamp a marker for a dead pane"
_armed "$PROV" "%99999" && no "a dead pane reads as armed" || ok "a dead pane never arms"
rm -rf "$PROV"

echo "== SELFCLEAR_FIRE records the context level — and NEVER blocks on it =="
# ⛔ OBSERVABILITY, NOT A GATE. The ~60% recycle rule is numeric and nothing recorded the number,
# so "does the fleet recycle near the target?" was unanswerable even in hindsight. But an
# unmeasurable context must NEVER stop a clear: myctx depends on jq, $CLAUDE_CODE_SESSION_ID and a
# readable transcript, and refusing on it would turn all three into fleet-wide halt conditions —
# a strictly larger outage than the risk removed. So BOTH directions are asserted here: the number
# is recorded when available, and its ABSENCE still fires.
_mk_ctx_stub() { printf '#!/bin/sh\necho "context: 412345 tok = %s of 1000k   (free: 58.8%%)"\n' "$1" > "$LCT/myctx-stub.sh"; chmod +x "$LCT/myctx-stub.sh"; }
: > "$LCT/lifecycle.log"
_mk_ctx_stub "41.2%"
KIJITO_MYCTX="$LCT/myctx-stub.sh" KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
KIJITO_MYCTX="$LCT/myctx-stub.sh" KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_DELAY=0.05 \
  TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "fires with a measurable context" 0 $?
grep -q 'SELFCLEAR_FIRE .*ctx=41.2%' "$LCT/lifecycle.log" && ok "logs the measured context level" \
  || { no "context level not in the audit log"; grep SELFCLEAR_FIRE "$LCT/lifecycle.log" | tail -1; }

: > "$LCT/lifecycle.log"
printf '#!/bin/sh\nexit 1\n' > "$LCT/myctx-broken.sh"; chmod +x "$LCT/myctx-broken.sh"
KIJITO_AUTOCATCHUP=1 bash "$QP" >/dev/null 2>&1
KIJITO_MYCTX="$LCT/myctx-broken.sh" KIJITO_AUTOCATCHUP=1 KIJITO_SELFCLEAR_DELAY=0.05 \
  TMUX="$TM" TMUX_PANE="$P" bash "$SC" >/dev/null 2>&1; chk "an UNMEASURABLE context does NOT block the clear" 0 $?
grep -q 'SELFCLEAR_FIRE .*ctx=UNMEASURABLE' "$LCT/lifecycle.log" && ok "records the absence honestly" \
  || no "did not record ctx=UNMEASURABLE"

echo "== arm-session.sh 'off' must not report a disarm it cannot deliver =="
# ⛔ REGRESSION GUARD FOR A CONTROL THAT LIED. Arming is an OR of two inputs — the pane marker and the
# seat-wide KIJITO_AUTOCATCHUP=1 — and `off` can only remove the marker. On a seat where the env var
# is set (Jason ordered it on the Ubuntu VM 2026-08-01), `off` deleted a file nothing consults and
# printed "AUTONOMY OFF: self-clear refused", while self-clear remained permitted. A human handing a
# pane back would have believed the pane was theirs.
# ★ Both directions, because that is the whole lesson: `off` must SUCCEED when the marker is the only
# input, and REFUSE when it is not. A test of only the refusal would pass against a script that
# always refuses — which is an outage, not a fix.
ARM="$SDIR/arm-session.sh"
# ⛔ THIS FIXTURE USED A SYNTHETIC PANE ID (`%77777`) AND WENT VACUOUS THE MOMENT MARKERS GAINED
# PROVENANCE: `on` correctly refuses to stamp a marker for a pane that does not exist, so every
# assertion below still PASSED while exercising nothing — "marker removed by off" was true because
# no marker was ever written. A test that passes for the wrong reason is worse than a missing one.
# ⇒ use the REAL live pane, in its own state dir so it cannot disturb the fixtures above.
APANE="$P"
LCA="$LCT/armtest"; mkdir -p "$LCA"
_armcheck() { KIJITO_LC_DIR="$LCA" bash -c ". '$LIB'; lc_marker_armed '$APANE'"; }
( env -u KIJITO_AUTOCATCHUP KIJITO_LC_DIR="$LCA" TMUX_PANE="$APANE" bash "$ARM" on >/dev/null 2>&1 )
out=$( env -u KIJITO_AUTOCATCHUP KIJITO_LC_DIR="$LCA" TMUX_PANE="$APANE" bash "$ARM" off 2>&1 ); r=$?
chk "off SUCCEEDS when the marker is the only input" 0 $r
case "$out" in *"AUTONOMY OFF"*) ok "off says AUTONOMY OFF when it is true" ;; *) no "off did not confirm the real disarm" ;; esac
[ -e "$LCA/arm.$APANE" ] && no "marker survived off" || ok "marker removed by off"

( env -u KIJITO_AUTOCATCHUP KIJITO_LC_DIR="$LCA" TMUX_PANE="$APANE" bash "$ARM" on >/dev/null 2>&1 )
out=$( KIJITO_AUTOCATCHUP=1 KIJITO_LC_DIR="$LCA" TMUX_PANE="$APANE" bash "$ARM" off 2>&1 ); r=$?
chk "off REFUSES (3) while KIJITO_AUTOCATCHUP=1 still arms the seat" 3 $r
case "$out" in *STOP*) ok "the refusal names the kill switch, the one brake that works" ;; *) no "refusal did not name STOP" ;; esac
[ -e "$LCA/arm.$APANE" ] && no "marker survived the refusing off" || ok "off still removes the marker before refusing"
# and the refusal must be TRUE — the pane really is still armed after it
out=$( KIJITO_AUTOCATCHUP=1 KIJITO_LC_DIR="$LCA" TMUX_PANE="$APANE" bash "$ARM" status 2>&1 )
case "$out" in *"armed (autonomous)"*) ok "still armed after off — the refusal was accurate" ;; *) no "status disagrees with the refusal" ;; esac
case "$out" in *marker=*env=*) ok "status prints BOTH arming inputs" ;; *) no "status hides one of the two inputs" ;; esac
rm -rf "$LCA"

echo "== audit log =="
[ -s "$LCT/lifecycle.log" ] && ok "log has entries" || no "no audit log"

tmux kill-session -t $S 2>/dev/null; tmux kill-session -t $S2 2>/dev/null; rm -rf "$LCT"
echo; echo "RESULT: $pass passed, $fail failed"; [ "$fail" -eq 0 ]

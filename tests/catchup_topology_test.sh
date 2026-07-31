#!/usr/bin/env bash
# Does session-catchup-hint.sh point the agent at the producer path THIS host actually uses?
#
# WHY THIS EXISTS. The hook hardcoded the macOS topology in five places: a pgrep for
# "kijito_inbox_monitor.py" (the Linux entry point is `kijito-inbox-monitor`, no .py), a `launchctl`
# restart hint (meaningless under systemd), Monitor templates naming
# ~/.cache/kijito-inbox-monitor/events.<p>.ndjson (the Linux producer writes ~/.kijito-monitor/<p>.jsonl),
# and a duplicate-consumer check keyed on the macOS filename.
#
# ⚠️ ALL FIVE FAIL TOWARD FALSE CALM, WHICH IS WHY NOBODY NOTICED FOR A RELEASE. An agent that obeys
# the hint tails a file that never appears; "no events" then reads exactly like "no mail", with no
# error, forever. Three personas hit this on one Linux seat in one evening (2026-07-31) — one was
# told "producer: DOWN" while it was up, one gave up and hand-built a REST poller.
#
# ⚠️ AND THE SUBTLER ONE THIS ALSO COVERS: the producer check asked a HOST-GLOBAL question
# ("is any producer running?") and printed a PER-PERSONA answer ("your producer is UP"). On a
# multi-persona seat those come apart routinely — a sibling's producer made the hook report green
# for a persona whose events file did not exist.
#
# HOW IT TESTS THE REAL SCRIPT. Process state is the input we must control and cannot fake with
# files, so `pgrep` is shimmed on PATH rather than the script being refactored for testability:
# the shipped script runs BYTE-FOR-BYTE as installed. The shim answers by inspecting the pattern it
# is handed, so the producer probe and the duplicate-consumer probe stay independently controllable.
#
#   bash tests/catchup_topology_test.sh              # run the checks
#   bash tests/catchup_topology_test.sh --mutation   # ALSO prove the checks can fail
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DEFAULT="$REPO/providers/claude/scripts/session-catchup-hint.sh"
pass=0; fail=0
red() { printf "  FAIL  %s\n" "$1"; fail=$((fail+1)); }
grn() { printf "  ok    %s\n" "$1"; pass=$((pass+1)); }

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed — the hook parses its stdin with jq."; exit 0; }

SHIMDIR="$(mktemp -d)"
cat > "$SHIMDIR/pgrep" <<'SHIM'
#!/usr/bin/env bash
# Fake pgrep. The hook probes twice with different patterns; answer each from the environment so a
# test can say "a producer is running but nothing is armed" and other combinations the real host
# cannot be made to reproduce on demand.
pat="$*"
case "$pat" in
  *"tail -n 0 -F"*) [ "${FAKE_ARMED:-0}" = 1 ] && { echo 4242; exit 0; }; exit 1 ;;
  *)                [ "${FAKE_PRODUCER:-0}" = 1 ] && { echo 1111; exit 0; }; exit 1 ;;
esac
SHIM
chmod 0755 "$SHIMDIR/pgrep"
trap 'rm -rf "$SHIMDIR"' EXIT

# Run the hook with a synthetic HOME + project. Echoes its combined output.
# $1=hook  $2=HOME  $3=project dir  (FAKE_PRODUCER / FAKE_ARMED come from the caller's env)
run_hook() {
  printf '{"source":"startup","cwd":"%s"}' "$3" \
    | PATH="$SHIMDIR:$PATH" HOME="$2" CLAUDE_PROJECT_DIR="$3" bash "$1" 2>/dev/null
}

# Build a synthetic seat. $1=layout (linux|mac|none), $2=persona, $3=create events file? (yes|no)
# Echoes the HOME path.
make_home() {
  local layout="$1" persona="$2" mkev="$3" h
  h="$(mktemp -d)"
  case "$layout" in
    linux) mkdir -p "$h/.kijito-monitor"
           [ "$mkev" = yes ] && : > "$h/.kijito-monitor/$persona.jsonl" ;;
    mac)   mkdir -p "$h/.cache/kijito-inbox-monitor"
           [ "$mkev" = yes ] && : > "$h/.cache/kijito-inbox-monitor/events.$persona.ndjson" ;;
  esac
  echo "$h"
}
make_proj() { local p; p="$(mktemp -d)"; echo "$1" > "$p/.kijito_persona"; echo "$p"; }

# All assertions for one hook build. Return 0 if every one held.
check_hook() {
  local hook="$1" label="$2" bad=0 out h proj
  proj="$(make_proj river)"

  # ---- A: Linux seat, this persona's producer running and its events file present ----
  h="$(make_home linux river yes)"
  out="$(FAKE_PRODUCER=1 FAKE_ARMED=0 run_hook "$hook" "$h" "$proj")"
  if grep -q "$h/.kijito-monitor/river.jsonl" <<<"$out"; then
    grn "$label: linux seat → Monitor template names the .kijito-monitor/<p>.jsonl path"
  else red "$label: linux seat → template does not name the Linux events path"; bad=1; fi
  if grep -q "producer: UP for 'river'" <<<"$out"; then
    grn "$label: linux seat → producer reported UP for the persona"
  else red "$label: linux seat → producer not reported UP"; bad=1; fi
  # A Mac path leaking into a Linux seat's instructions is the original defect verbatim.
  if grep -q ".cache/kijito-inbox-monitor" <<<"$out"; then
    red "$label: linux seat → macOS events path still present in the agent-facing output"; bad=1
  else grn "$label: linux seat → no macOS path in the agent-facing output"; fi
  if grep -q "launchctl" <<<"$out"; then
    red "$label: linux seat → launchctl hint offered on a systemd host"; bad=1
  else grn "$label: linux seat → no launchctl hint"; fi
  rm -rf "$h"

  # ---- B: a producer runs, but NOT for this persona (no events file) ----
  # The multi-persona case. A host-global check calls this UP and sends the agent to tail a file
  # that will never exist — the exact false-calm failure, and the one hardest to notice.
  h="$(make_home linux river no)"
  out="$(FAKE_PRODUCER=1 FAKE_ARMED=0 run_hook "$hook" "$h" "$proj")"
  if grep -q "NOT for 'river'" <<<"$out"; then
    grn "$label: sibling-only producer → reported as NOT covering this persona"
  else red "$label: sibling-only producer → wrongly reported as covering this persona"; bad=1; fi
  rm -rf "$h"

  # ---- C: no producer at all, Linux seat → systemd restart hint ----
  h="$(make_home linux river no)"
  out="$(FAKE_PRODUCER=0 FAKE_ARMED=0 run_hook "$hook" "$h" "$proj")"
  if grep -q "producer: DOWN" <<<"$out" && grep -q "systemctl --user enable --now kijito-inbox-monitor@river" <<<"$out"; then
    grn "$label: no producer on linux → DOWN with a systemd restart hint"
  else red "$label: no producer on linux → missing DOWN or systemd hint"; bad=1; fi
  rm -rf "$h"

  # ---- D: macOS seat still works — this is a portability fix, not a platform swap ----
  # ⚠️ Without this direction, deleting the Mac branch entirely would pass every other check while
  # breaking every existing user. The fix must be additive.
  h="$(make_home mac river yes)"
  out="$(FAKE_PRODUCER=1 FAKE_ARMED=0 run_hook "$hook" "$h" "$proj")"
  if grep -q "$h/.cache/kijito-inbox-monitor/events.river.ndjson" <<<"$out"; then
    grn "$label: mac seat → Monitor template still names the events.<p>.ndjson path"
  else red "$label: mac seat → macOS layout regressed"; bad=1; fi
  if grep -q "launchctl kickstart" <<<"$out" || grep -q "producer: UP" <<<"$out"; then
    grn "$label: mac seat → launchd vocabulary retained"
  else red "$label: mac seat → launchd hint lost"; bad=1; fi
  rm -rf "$h"

  # ---- E: duplicate-consumer detection fires on a Linux seat ----
  # This branch was DEAD on Linux: its pattern could only match the macOS filename, so a returning
  # session was always told to arm again — re-creating the duplicate-monitor bug the branch exists
  # to prevent, on exactly the hosts where nobody was watching for it.
  h="$(make_home linux river yes)"
  out="$(FAKE_PRODUCER=1 FAKE_ARMED=1 run_hook "$hook" "$h" "$proj")"
  if grep -q "do NOT blindly add another" <<<"$out"; then
    grn "$label: linux seat → existing consumer detected (no duplicate-arm advice)"
  else red "$label: linux seat → duplicate-consumer detection did not fire"; bad=1; fi
  rm -rf "$h" "$proj"

  return $bad
}

echo "catch-up hook topology checks:"
check_hook "$HOOK_DEFAULT" "hook"

# --- mutation: prove the checks can fail --------------------------------------------------------
# Restore the ORIGINAL hardcoded macOS topology in a copy and require the checks to fail. This
# mutates toward the real shipped defect rather than toward an invented one, so a green mutation
# line means "these checks would have caught 0.1.2", not merely "these checks can fail somehow".
if [ "${1:-}" = "--mutation" ]; then
  echo
  echo "mutation (hook with the hardcoded macOS topology MUST fail the checks above):"
  mut="$(mktemp -d)/session-catchup-hint.sh"
  mkdir -p "$(dirname "$mut")"
  sed -e 's|_events="\$_lnx_events"; _sup="systemd"|_events="$_mac_events"; _sup="launchd"|g' \
      "$HOOK_DEFAULT" > "$mut"
  if ! grep -q '_events="\$_mac_events"; _sup="launchd"' "$mut"; then
    red "mutation did not apply — the sed no longer matches, so this direction proves nothing"
  else
    # The mutant's deliberate failures must not reach the suite tally; take the verdict from the
    # return code and restore the counters. (The first draft of the sibling install-mode test got
    # this wrong and reported "failed: 3" on a fully-green run.)
    _p=$pass; _f=$fail
    check_hook "$mut" "MUTANT" >/dev/null 2>&1; mrc=$?
    pass=$_p; fail=$_f
    if [ "$mrc" -eq 0 ]; then
      red "mutation SURVIVED — the checks pass with the macOS topology forced, so they test nothing"
    else
      grn "mutation killed — the checks fail when the topology is hardcoded to macOS"
    fi
  fi
  rm -rf "$(dirname "$mut")"
fi

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1

#!/usr/bin/env bash
# Shared helpers for Kijito session-lifecycle scripts. SOURCE this (`. lifecycle-lib.sh`), don't exec.
KIJITO_LC_DIR="${KIJITO_LC_DIR:-$HOME/.claude/.lifecycle}"
mkdir -p "$KIJITO_LC_DIR" 2>/dev/null
KIJITO_LC_LOG="$KIJITO_LC_DIR/lifecycle.log"
KIJITO_LC_STOP="$KIJITO_LC_DIR/STOP"

lc_now() { date +%s; }                                   # epoch (portable BSD/GNU)

lc_log() {                                               # M2 — audit log:  action [detail]
  printf '%s sid=%s pane=%s %s %s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S')" "${CLAUDE_CODE_SESSION_ID:-?}" "${TMUX_PANE:-?}" "$1" "${2:-}" \
    >> "$KIJITO_LC_LOG" 2>/dev/null
}

lc_stopped() { [ -f "$KIJITO_LC_STOP" ]; }              # M1 — kill switch: `touch ~/.claude/.lifecycle/STOP` halts all

# C3 — best-effort subagent guard. VERIFIED 2026-06-24: a subagent shares the parent's
# CLAUDE_CODE_SESSION_ID / CLAUDE_CODE_CHILD_SESSION / ENTRYPOINT, so there is NO reliable env
# discriminator today. This only trips on FUTURE markers and NEVER false-positives the main
# session (both are unset now). Real C3 protection = consumable QA token + kill switch.
# (The cycle cap was part of this list until 2026-07-29, when it was removed as non-discriminating —
# see self-clear.sh "C2". Do not cite it as protection.)
lc_is_child() { [ -n "${CLAUDE_AGENT_TYPE:-}" ] || [ -n "${CLAUDE_CODE_AGENT:-}" ]; }

# ⛔ THIS GATE RETURNED TRUE FOR EVERY INPUT, INCLUDING GARBAGE — IT HAD NEVER ONCE REFUSED.
# Found by argus 2026-08-01, measured on Linux tmux 3.4 AND macOS tmux 3.6a. The old body asked
# `tmux display-message -p -t "$1" '#{session_name}'` and read its EXIT CODE — but display-message
# EXITS 0 FOR A NONEXISTENT PANE, it simply prints empty fields:
#     $ tmux display-message -p -t %999 'sess=#{session_name}'   ->  "sess="   rc=0
# so `lc_pane_alive %999`, and even `lc_pane_alive nonsense`, were both TRUE.
#
# ★ WHY IT SURVIVED SO LONG: it was only ever exercised against a LIVE pane — the one input
# incapable of exposing it. A control verified solely in the direction it was designed to move is
# not verified at all. (Reproduced before fixing: %999 and "nonsense" TRUE on the old body, both
# FALSE on this one, real pane still TRUE.)
#
# ⚠️ BOUNDED HONESTLY, per argus: `send-keys` itself refuses on a dead pane, and enumerating every
# pane on the host confirmed a dead-pane /clear lands in NO pane — so this could not misfire into a
# sibling's session on a shared seat. The gate was decorative, not dangerous.
#
# ENUMERATE, DON'T ASK. `list-panes -a` is the authoritative set; `grep -Fqx` matches a whole line
# literally, so `%1` cannot match `%11` and a metacharacter in the argument cannot act as a pattern.
# Portable across BSD and GNU userland.
lc_pane_alive() {
  command -v tmux >/dev/null 2>&1 || return 1
  [ -n "${1:-}" ] || return 1
  tmux list-panes -a -F '#{pane_id}' 2>/dev/null | grep -Fqx -- "$1"
}

# M4 (FIXED) — a running claude pane reports pane_current_command as its VERSION (e.g. "2.1.190"),
# NOT "claude"/"node" (verified 2026-06-24). So check "not a bare shell" instead of whitelisting claude.
lc_pane_usable() {
  [ "${KIJITO_LC_TEST:-0}" = "1" ] && return 0          # test-harness escape hatch
  local c; c=$(tmux display-message -p -t "$1" '#{pane_current_command}' 2>/dev/null)
  case "$c" in ""|zsh|bash|sh|-zsh|-bash|-sh|fish|tcsh|dash) return 1 ;; *) return 0 ;; esac
}

# Arming has TWO INDEPENDENT INPUTS, and they are ORed. Keep them as separate named predicates:
# anything that REPORTS on arming, or claims to change it, must be able to say WHICH one is in force.
#   (1) per-pane marker — claude-armed.sh / arm-session.sh drop a file keyed to the pane; the hook
#       (which reliably has TMUX_PANE) reads it. Session-scoped, removable by the agent.
#   (2) KIJITO_AUTOCATCHUP=1 — a SEAT-WIDE env var, typically set in ~/.claude/settings.json, which
#       reaches every session on the host. A running process CANNOT unset it for itself, so it is not
#       revocable from inside a session at all.
# ⛔ WHY THE SPLIT EXISTS: while (2) is in force, deleting the marker changes NOTHING. `arm-session.sh
# off` did exactly that and printed "AUTONOMY OFF" — a control that reported success without acting,
# which is worse than one that errors (measured by ladybug on the Ubuntu VM 2026-08-01: with
# KIJITO_AUTOCATCHUP=1 live, `lc_is_armed %99999` — a pane that does not exist — returns ARMED).
# The only brake that works against (2) is the kill switch: touch "$KIJITO_LC_DIR/STOP".
lc_marker_armed() { [ -f "$KIJITO_LC_DIR/arm.${1:-${TMUX_PANE:-x}}" ]; }
lc_env_armed()    { [ "${KIJITO_AUTOCATCHUP:-0}" = "1" ]; }
lc_is_armed()     { lc_marker_armed "${1:-}" || lc_env_armed; }

# qa-token is SESSION-keyed (correct: each post-/clear session must earn its OWN fresh QA pass).
lc_qa_token()   { echo "$KIJITO_LC_DIR/qa-pass.${CLAUDE_CODE_SESSION_ID:-nosession}"; }
# The cycle counter is PANE-keyed: /clear ROTATES CLAUDE_CODE_SESSION_ID (verified live: 1c5947c1→
# 6f305fa1 in the same pane %19), so a session-keyed counter would reset every clear and never
# accumulate across the self-clear loop. The pane persists across clears → accumulates correctly.
# ⚠️ Since 2026-07-29 this counter is TELEMETRY ONLY — nothing gates on it (see self-clear.sh "C2").
# It stays because the cycle number is useful in the audit log; it is not a limit.
lc_cycle_file() { echo "$KIJITO_LC_DIR/cycles.${TMUX_PANE:-${CLAUDE_CODE_SESSION_ID:-nosession}}"; }

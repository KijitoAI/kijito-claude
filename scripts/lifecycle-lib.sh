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
# session (both are unset now). Real C3 protection = consumable QA token + cycle cap + kill switch.
lc_is_child() { [ -n "${CLAUDE_AGENT_TYPE:-}" ] || [ -n "${CLAUDE_CODE_AGENT:-}" ]; }

lc_pane_alive() { command -v tmux >/dev/null 2>&1 && tmux display-message -p -t "$1" '#{session_name}' >/dev/null 2>&1; }

# M4 (FIXED) — a running claude pane reports pane_current_command as its VERSION (e.g. "2.1.190"),
# NOT "claude"/"node" (verified 2026-06-24). So check "not a bare shell" instead of whitelisting claude.
lc_pane_usable() {
  [ "${KIJITO_LC_TEST:-0}" = "1" ] && return 0          # test-harness escape hatch
  local c; c=$(tmux display-message -p -t "$1" '#{pane_current_command}' 2>/dev/null)
  case "$c" in ""|zsh|bash|sh|-zsh|-bash|-sh|fish|tcsh|dash) return 1 ;; *) return 0 ;; esac
}

# Per-spawn arming (ROBUST — no env-propagation dependency): claude-armed.sh drops a marker keyed to
# the pane; the hook (which reliably has TMUX_PANE) reads it. Also honors KIJITO_AUTOCATCHUP=1.
lc_is_armed() { [ -f "$KIJITO_LC_DIR/arm.${1:-${TMUX_PANE:-x}}" ] || [ "${KIJITO_AUTOCATCHUP:-0}" = "1" ]; }

# qa-token is SESSION-keyed (correct: each post-/clear session must earn its OWN fresh QA pass).
lc_qa_token()   { echo "$KIJITO_LC_DIR/qa-pass.${CLAUDE_CODE_SESSION_ID:-nosession}"; }
# cycle/checkpoint are PANE-keyed: /clear ROTATES CLAUDE_CODE_SESSION_ID (verified live: 1c5947c1→
# 6f305fa1 in the same pane %19), so a session-keyed counter resets every clear and the cap/checkpoint
# never accumulate across the self-clear loop. The pane persists across clears → accumulate correctly.
lc_cycle_file() { echo "$KIJITO_LC_DIR/cycles.${TMUX_PANE:-${CLAUDE_CODE_SESSION_ID:-nosession}}"; }

#!/usr/bin/env bash
# Launch an ARMED Claude Code session: when in tmux it auto-sends the catch-up prompt (instigating
# its own first turn) and continues preloaded work. Use for orchestrator/unattended panes + the
# self-clear loop. Plain `claude` is NOT armed → never collides with you typing.
#
# Arming is a per-pane MARKER file (robust; doesn't depend on env reaching the hook). The marker is
# removed when claude exits (trap). KIJITO_AUTOCATCHUP=1 is also exported as a belt-and-suspenders.
# Resolve the shared lib NEXT TO THIS SCRIPT so the repo copy is runnable/testable in place, and
# fall back to the installed location for a stray single-file copy. KIJITO_LC_LIB overrides both.
_kjt_lib="${KIJITO_LC_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lifecycle-lib.sh}"
[ -f "$_kjt_lib" ] || _kjt_lib="$HOME/.claude/lifecycle-lib.sh"
. "$_kjt_lib" 2>/dev/null
marker="${KIJITO_LC_DIR:-$HOME/.claude/.lifecycle}/arm.${TMUX_PANE:-nopane}"
mkdir -p "$(dirname "$marker")" 2>/dev/null
touch "$marker" 2>/dev/null
trap 'rm -f "$marker"' EXIT INT TERM

# Hosted Kijito MCP bearer token for .mcp.json's ${KIJITO_API_TOKEN} — read from a file so it is
# reliable inside the armed loop regardless of which shell profile did (or didn't) load. Only set it
# if the file exists AND the var isn't already provided by the environment.
if [ -z "${KIJITO_API_TOKEN:-}" ] && [ -r "${KIJITO_API_TOKEN_FILE:-$HOME/.claude/.kijito_api_token}" ]; then
  export KIJITO_API_TOKEN="$(cat "${KIJITO_API_TOKEN_FILE:-$HOME/.claude/.kijito_api_token}" 2>/dev/null)"
fi

# Remote Control for armed/autonomous panes: it lets you check an unattended session from a phone,
# which is the normal reason to arm one. RC is a per-PROCESS feature — it survives /clear but NOT a
# fresh launch, and an agent cannot self-invoke a slash command, so it has to be set here at start.
#
# Both knobs are opt-OUT-able because this ships to other people's machines:
#   KIJITO_REMOTE_CONTROL=0   → don't enable remote control at all
#   KIJITO_RC_PREFIX=<name>   → session-name prefix; makes the pane easy to spot in the session list.
# The prefix defaults to this project's persona (the `.kijito_persona` marker, same file the
# SessionStart hook reads), so an armed river pane is named "river-*" and an argus one "argus-*"
# without anyone hardcoding a name. No marker → no prefix, rather than someone else's persona.
rc_args=()
if [ "${KIJITO_REMOTE_CONTROL:-1}" != "0" ]; then
  rc_args+=(--remote-control)
  rc_prefix="${KIJITO_RC_PREFIX:-}"
  if [ -z "$rc_prefix" ]; then
    for d in "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
      if [ -n "$d" ] && [ -f "$d/.kijito_persona" ]; then
        rc_prefix=$(head -n1 "$d/.kijito_persona" | tr -d '[:space:]')
        [ -n "$rc_prefix" ] && break
      fi
    done
  fi
  [ -n "$rc_prefix" ] && rc_args+=(--remote-control-session-name-prefix "$rc_prefix")
fi
KIJITO_AUTOCATCHUP=1 claude "${rc_args[@]+"${rc_args[@]}"}" "$@"

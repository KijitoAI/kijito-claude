#!/usr/bin/env bash
# Launch an ARMED Claude Code session: when in tmux it auto-sends the catch-up prompt (instigating
# its own first turn) and continues preloaded work. Use for orchestrator/unattended panes + the
# self-clear loop. Plain `claude` is NOT armed → never collides with you typing.
#
# Arming is a per-pane MARKER file (robust; doesn't depend on env reaching the hook). The marker is
# removed when claude exits (trap). KIJITO_AUTOCATCHUP=1 is also exported as a belt-and-suspenders.
. "$HOME/.claude/lifecycle-lib.sh" 2>/dev/null
marker="${KIJITO_LC_DIR:-$HOME/.claude/.lifecycle}/arm.${TMUX_PANE:-nopane}"
mkdir -p "$(dirname "$marker")" 2>/dev/null
touch "$marker" 2>/dev/null
trap 'rm -f "$marker"' EXIT INT TERM
KIJITO_AUTOCATCHUP=1 claude "$@"

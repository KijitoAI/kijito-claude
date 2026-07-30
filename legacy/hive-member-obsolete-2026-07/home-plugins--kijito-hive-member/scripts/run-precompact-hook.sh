#!/bin/sh

# Keep PreCompact fail-closed even when Node or the launcher exits before it can
# emit hook JSON. Capture stdout so a partial response from a crashing runtime
# is never forwarded to Codex. Enforce a deadline shorter than the Codex hook
# timeout so the wrapper, rather than the harness, controls the failure output.

set -u

child_pid=
watchdog_pid=
output_file=

fail_closed() {
  # The dollar sign is intentional: this is a Codex skill name, not shell data.
  # shellcheck disable=SC2016
  printf '%s\n' '{"continue":false,"stopReason":"Kijito PreCompact runtime failed; compaction is blocked.","systemMessage":"Compaction blocked because the Kijito pre-compaction runtime failed safely. Repair the hook/runtime, rerun $kijito-qa-memory, and retry."}'
}

# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  if [ -n "$watchdog_pid" ]; then
    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
  fi
  if [ -n "$child_pid" ]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  if [ -n "$output_file" ]; then
    /bin/rm -f "$output_file" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'fail_closed; exit 0' HUP INT TERM

plugin_root=${PLUGIN_ROOT:-}
if [ -z "$plugin_root" ]; then
  fail_closed
  exit 0
fi

self_timeout=${KIJITO_PRECOMPACT_SELF_TIMEOUT_SECONDS:-10}
case "$self_timeout" in
  1|2|3|4|5|6|7|8|9|10) ;;
  *) self_timeout=10 ;;
esac

state_dir=${PLUGIN_DATA:-${TMPDIR:-/tmp}}
output_file=$state_dir/.kijito-precompact-output.$$
if ! (umask 077; set -C; : >"$output_file") 2>/dev/null; then
  fail_closed
  exit 0
fi

(
  # POSIX specifies ulimit -f in 512-byte blocks. Keep even a runaway child
  # response bounded; exceeding the limit makes the inner run fail closed.
  ulimit -f 128 2>/dev/null || exit 70
  exec /bin/sh "$plugin_root/scripts/run-node.sh" \
    "$plugin_root/scripts/hook.mjs" --expect PreCompact
) <&0 >"$output_file" &
child_pid=$!

(
  /bin/sleep "$self_timeout"
  kill -TERM "$child_pid" 2>/dev/null || exit 0
  /bin/sleep 1
  kill -KILL "$child_pid" 2>/dev/null || true
) &
watchdog_pid=$!

if wait "$child_pid"; then
  inner_ok=1
else
  inner_ok=0
fi
child_pid=
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
watchdog_pid=

if [ "$inner_ok" -eq 1 ] && [ -s "$output_file" ]; then
  /bin/cat "$output_file"
else
  fail_closed
fi

exit 0

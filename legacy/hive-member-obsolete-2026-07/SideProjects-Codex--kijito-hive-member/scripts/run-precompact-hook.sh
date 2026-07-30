#!/bin/sh

# Never let a Kijito runtime failure veto Codex's own context compaction. Capture
# stdout so a partial response from a crashing runtime is never forwarded, then
# emit a valid fail-soft response. Memory attestation may degrade; host liveness
# may not.

set -u

child_pid=
watchdog_pid=
output_file=

fail_soft() {
  printf '%s\n' '{"continue":true,"systemMessage":"Kijito PreCompact runtime failed; native compaction will proceed to preserve host liveness, and PostCompact must recover in explicit unattested mode."}'
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
trap 'fail_soft; exit 0' HUP INT TERM

plugin_root=${PLUGIN_ROOT:-}
if [ -z "$plugin_root" ]; then
  fail_soft
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
  fail_soft
  exit 0
fi

(
  # POSIX specifies ulimit -f in 512-byte blocks. Keep even a runaway child
  # response bounded; exceeding the limit makes the inner run fail and the
  # wrapper emit its explicit fail-soft response.
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
  fail_soft
fi

exit 0

#!/bin/sh

# Codex hooks are launched by a shell, whose PATH can differ from the runtime
# used to install or supervise this plugin. Resolve a working Node.js runtime
# without assuming that the first `node` on PATH is usable.

set -eu

if [ "$#" -lt 1 ]; then
  printf '%s\n' "kijito_node_launcher: missing script argument" >&2
  exit 64
fi

is_usable_node() {
  candidate=$1
  case "$candidate" in
    /*) ;;
    *) return 1 ;;
  esac
  [ -f "$candidate" ] && [ -x "$candidate" ] || return 1
  major=$(
    NODE_OPTIONS='' NODE_PATH='' "$candidate" \
      -p 'require("node:http"); require("node:https"); require("node:crypto"); process.versions.node.split(".")[0]' \
      2>/dev/null
  ) || return 1
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge 18 ]
}

run_with_node() {
  candidate=$1
  shift
  if is_usable_node "$candidate"; then
    NODE_OPTIONS='' NODE_PATH='' exec "$candidate" "$@"
  fi
}

if [ -n "${KIJITO_NODE:-}" ]; then
  run_with_node "$KIJITO_NODE" "$@"
fi

path_node=$(command -v node 2>/dev/null || true)
if [ -n "$path_node" ]; then
  run_with_node "$path_node" "$@"
fi

for candidate in \
  "$HOME"/.nvm/versions/node/*/bin/node \
  "$HOME"/.volta/bin/node \
  "$HOME"/.local/share/mise/installs/node/*/bin/node \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node
do
  run_with_node "$candidate" "$@"
done

printf '%s\n' "kijito_node_launcher: no usable Node.js 18+ runtime found" >&2
exit 127

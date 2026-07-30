#!/usr/bin/env bash
# kijito-claude — provider dispatcher.
#
# This repo installs the Kijito session toolkit for more than one agent host. Each host is a
# PROVIDER under providers/, owns its own installer, and installs to its own location:
#
#   claude  (default)  providers/claude/install.sh    → ~/.claude          — bash scripts + skills
#   codex              providers/codex/install.mjs    → WITHDRAWN notifier; skills-only remains safe
#
#   ./install.sh                      # claude, unchanged from before the providers/ split
#   ./install.sh --provider codex     # WITHDRAWN; use only with --skills-only
#   ./install.sh --list-providers
#
# ⚠️ THE DEFAULT IS LOAD-BEARING AND MUST STAY `claude`. `npx kijito-claude` and
# `pipx run kijito-claude` both land here with no arguments, and they have been installing the
# Claude toolkit since 0.1.0. Changing the default would silently retarget every existing user.
#
# Unrecognized arguments are passed through to the provider's own installer untouched, so a
# provider can add flags without this file needing to know about them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PROVIDERS_DIR="$ROOT/providers"

list_providers() {
  # _shared holds provider-neutral code, not a provider. Anything else with an installer counts.
  for d in "$PROVIDERS_DIR"/*/; do
    name="$(basename "$d")"
    [ "$name" = "_shared" ] && continue
    if [ -f "$d/install.sh" ] || [ -f "$d/install.mjs" ]; then echo "$name"; fi
  done
}

usage() {
  echo "usage: install.sh [--provider <name>] [provider args...]"
  echo
  echo "providers:"
  list_providers | sed 's/^/  /'
  echo
  echo "default provider: claude"
}

PROVIDER="claude"
# bash 3.2 (the macOS default) errors on "${arr[@]}" when arr is empty under `set -u`, so this
# array is always expanded through the ${arr[@]+...} guard below.
PASSTHROUGH=()
while [ $# -gt 0 ]; do
  case "$1" in
    --provider)
      [ $# -ge 2 ] || { echo "ERROR: --provider needs a value" >&2; exit 2; }
      PROVIDER="$2"; shift 2 ;;
    --provider=*) PROVIDER="${1#*=}"; shift ;;
    --list-providers) list_providers; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) PASSTHROUGH+=("$1"); shift ;;
  esac
done

PROVIDER_DIR="$PROVIDERS_DIR/$PROVIDER"
if [ "$PROVIDER" = "_shared" ] || [ ! -d "$PROVIDER_DIR" ]; then
  echo "ERROR: unknown provider '$PROVIDER'. Known providers:" >&2
  list_providers | sed 's/^/  /' >&2
  exit 2
fi

if [ -f "$PROVIDER_DIR/install.sh" ]; then
  exec bash "$PROVIDER_DIR/install.sh" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
elif [ -f "$PROVIDER_DIR/install.mjs" ]; then
  command -v node >/dev/null 2>&1 || {
    echo "ERROR: provider '$PROVIDER' needs Node.js 20+ on PATH." >&2; exit 1; }
  exec node "$PROVIDER_DIR/install.mjs" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
else
  echo "ERROR: provider '$PROVIDER' has no install.sh or install.mjs." >&2
  exit 2
fi

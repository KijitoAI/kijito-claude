#!/usr/bin/env bash
# kijito-claude — provider dispatcher.
#
# This repo installs the Kijito session toolkit for more than one agent host. Each host is a
# PROVIDER under providers/, owns its own installer, and installs to its own location:
#
#   claude  (default)  providers/claude/install.sh    → ~/.claude          — bash scripts + skills
#   codex              providers/codex/install.mjs    → ~/.local/share/…   — Node wake controller
#
#   ./install.sh                      # claude, unchanged from before the providers/ split
#   ./install.sh --provider codex     # codex
#   ./install.sh --list-providers
#   ./install.sh --from-main          # install the stable main bytes (branch-state-immune)
#   ./install.sh --allow-branch       # deliberately install THIS branch's bytes (off-main opt-in)
#
# ⚠️ THE DEFAULT IS LOAD-BEARING AND MUST STAY `claude`. `npx kijito-claude` and
# `pipx run kijito-claude` both land here with no arguments, and they have been installing the
# Claude toolkit since 0.1.0. Changing the default would silently retarget every existing user.
#
# ⚠️ ROLLOUT SAFETY — WHY --from-main EXISTS (two independent wrongs, measured 2026-08-08 by assay):
#   (1) the installer COPIES files into ~/.claude — a deployed hook/skill is a COPY, not a symlink,
#       so it NEVER tracks the repo after install; and
#   (2) the install reads the CURRENT WORKING TREE, whose bytes follow whatever branch is checked
#       out — so a fleet seat that runs a bare `./install.sh` while this SHARED checkout sits on
#       someone's feature branch silently bakes that branch's in-progress bytes into its hooks.
#   Either wrong alone is survivable; together they let a seat converge on stale/unreleased bytes
#   with no error (only reading the installed CONTENT catches it). So main is the documented fleet
#   path (--from-main, installed via a detached worktree so the caller's branch is untouched), and
#   installing from any OTHER branch is made OPT-IN (--allow-branch) — a mere warning still installs
#   the wrong bytes for anyone who does not read it, so the unsafe path must be opt-in, not opt-out.
#   (A non-git checkout — npm/pipx packaged release — has no branch to be wrong about, so it is
#   exempt: the bytes ARE the release.)
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
  echo "usage: install.sh [--provider <name>] [--from-main | --allow-branch] [provider args...]"
  echo
  echo "providers:"
  list_providers | sed 's/^/  /'
  echo
  echo "default provider: claude"
  echo
  echo "rollout safety (git checkouts only):"
  echo "  --from-main       install the stable main bytes via a detached worktree (recommended)"
  echo "  --allow-branch    deliberately install the current (off-main) branch's bytes"
}

# ROLLOUT SAFETY (see the header). git checkouts only; a packaged (non-git) install is exempt.
# branch_guard refuses a bare install from an off-main checkout; from_main_install performs the
# main-worktree install. Both are no-ops outside a git checkout.
_on_main_commit() {
  # True iff HEAD sits at main's COMMIT (so a detached HEAD at main counts, not just the branch name).
  local head_sha main_sha
  head_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
  main_sha="$(git -C "$ROOT" rev-parse main 2>/dev/null || true)"
  [ -n "$head_sha" ] && [ "$head_sha" = "$main_sha" ]
}

branch_guard() {
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || return 0   # not a git checkout → exempt
  _on_main_commit && return 0                                       # already main → nothing to guard
  local cur
  cur="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(unknown)')"
  if [ "$ALLOW_BRANCH" -eq 1 ]; then
    echo "kijito-claude: installing from '$cur' (off main) — --allow-branch given, proceeding." >&2
    return 0
  fi
  cat >&2 <<EOF
ERROR: kijito-claude is checked out on '$cur', not main.
The installer COPIES the current working tree into ~/.claude, so a bare install here would bake
'$cur' bytes into your hooks and skills — and they will NOT update afterward. Choose one:
  ./install.sh --from-main       # install the stable main bytes (recommended; branch-state-immune)
  ./install.sh --allow-branch    # deliberately install THIS branch's bytes
EOF
  exit 3
}

from_main_install() {
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "ERROR: --from-main needs a git checkout of kijito-claude (this is a packaged install)." >&2
    exit 3; }
  local main_sha
  main_sha="$(git -C "$ROOT" rev-parse main 2>/dev/null || true)"
  [ -n "$main_sha" ] || { echo "ERROR: --from-main: no local 'main' ref in $ROOT." >&2; exit 3; }
  _on_main_commit && return 0    # already at main's commit → fall through to the normal install
  local wt
  wt="$(mktemp -d "${TMPDIR:-/tmp}/kjt-claude-main.XXXXXX")"
  # --detach: main may be checked out elsewhere; a detached worktree at its commit always succeeds.
  git -C "$ROOT" worktree add --detach "$wt" main >/dev/null 2>&1 || {
    echo "ERROR: --from-main: could not create a main worktree." >&2; rmdir "$wt" 2>/dev/null; exit 3; }
  local rc=0
  # Re-invoke the MAIN copy of this installer (its own guard sees main and passes). Do NOT pass
  # --from-main again — no recursion. Preserve provider + any passthrough args.
  bash "$wt/install.sh" --provider "$PROVIDER" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"} || rc=$?
  # The install only READS the worktree (it copies OUT), so it stays clean → remove without --force
  # (IRREVERSIBLE: never --force/prune a worktree — that can destroy a sibling's uncommitted work).
  git -C "$ROOT" worktree remove "$wt" >/dev/null 2>&1 || true
  exit "$rc"
}

PROVIDER="claude"
FROM_MAIN=0
ALLOW_BRANCH=0
# bash 3.2 (the macOS default) errors on "${arr[@]}" when arr is empty under `set -u`, so this
# array is always expanded through the ${arr[@]+...} guard below.
PASSTHROUGH=()
while [ $# -gt 0 ]; do
  case "$1" in
    --provider)
      [ $# -ge 2 ] || { echo "ERROR: --provider needs a value" >&2; exit 2; }
      PROVIDER="$2"; shift 2 ;;
    --provider=*) PROVIDER="${1#*=}"; shift ;;
    --from-main) FROM_MAIN=1; shift ;;
    --allow-branch) ALLOW_BRANCH=1; shift ;;
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

# ROLLOUT SAFETY gate — runs after provider validation, before any install.
# --from-main installs the stable main bytes (and exits), unless HEAD is already main (falls
# through); otherwise branch_guard refuses a silent off-main install unless --allow-branch opts in.
if [ "$FROM_MAIN" -eq 1 ]; then
  from_main_install
fi
branch_guard

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

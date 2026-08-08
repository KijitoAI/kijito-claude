#!/usr/bin/env bash
# ROLLOUT SAFETY: does install.sh install the bytes you MEANT to, not whatever branch is checked out?
#
# WHY THIS EXISTS. The installer COPIES the working tree into ~/.claude (a deployed hook is a copy,
# not a symlink) AND reads whatever branch the SHARED checkout has checked out. Together those two
# facts let a fleet seat running a bare `./install.sh` bake a feature branch's in-progress bytes into
# its hooks with no error — measured 2026-08-08 (assay), where a seat installed STALE bytes because
# the shared checkout sat on a branch predating the fix on main, and only reading the installed
# CONTENT caught it. The remedy is: refuse a silent off-main install (require --allow-branch to opt
# in), and offer --from-main to install the stable main bytes branch-state-immune via a worktree.
#
# ⚠️ WHY A UNIT TEST OF THE GUARD LOGIC WOULD NOT BE ENOUGH: the property is about which BYTES land,
# across a real git checkout + worktree. So this drives the REAL install.sh end to end against
# throwaway git repos, using a STUB provider that records the marker it saw (never touching ~/.claude
# or invoking the real claude installer).
#
#   bash tests/install_rollout_test.sh              # run the checks
#   bash tests/install_rollout_test.sh --mutation   # ALSO prove the checks can fail (neuter the guard)
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUTATION=0
[ "${1:-}" = "--mutation" ] && MUTATION=1

pass=0; fail=0
red() { printf "  FAIL  %s\n" "$1"; fail=$((fail+1)); }
grn() { printf "  ok    %s\n" "$1"; pass=$((pass+1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kjt-rollout.XXXXXX")"
cleanup() { chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# Build a throwaway git repo that contains the REAL install.sh + a stub provider. main carries
# marker "MAIN"; a feature branch carries "FEATURE". $1 = install.sh to embed (real or mutated).
make_repo() {  # $1 = installer path, $2 = dest dir
  local inst="$1" dir="$2"
  mkdir -p "$dir/providers/testprov"
  cp "$inst" "$dir/install.sh"
  cat > "$dir/providers/testprov/install.sh" <<'PROV'
#!/usr/bin/env bash
# STUB provider: record the marker from the working tree this install ran against.
set -eu
out="${KJT_TEST_OUT:?KJT_TEST_OUT unset}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cat "$root/VERSION_MARKER" > "$out"
PROV
  printf 'MAIN\n' > "$dir/VERSION_MARKER"
  ( cd "$dir"
    git init -q
    git config user.email t@t; git config user.name t
    git symbolic-ref HEAD refs/heads/main
    git add -A; git commit -qm main
    git checkout -q -b feature
    printf 'FEATURE\n' > VERSION_MARKER
    git commit -qam feature
    git checkout -q main            # leave it on main; each scenario sets the branch it needs
  )
}

# Run install.sh in $1, capturing exit code + the recorded marker (or "<none>" if nothing installed).
run() {  # $1 = repo dir; rest = install args
  local dir="$1"; shift
  local out="$dir/.installed_marker"; rm -f "$out"
  local rc=0
  ( cd "$dir"; KJT_TEST_OUT="$out" bash install.sh --provider testprov "$@" >/dev/null 2>&1 ) || rc=$?
  RC=$rc
  MARKER="$( [ -f "$out" ] && cat "$out" || echo '<none>' )"
}

# ───────────────── the real guard ─────────────────
if [ "$MUTATION" -eq 0 ]; then
  echo "install_rollout_test — REAL guard"

  # A. bare install from an off-main checkout is REFUSED, and nothing is installed.
  make_repo "$REPO/install.sh" "$WORK/a"
  ( cd "$WORK/a"; git checkout -q feature )
  run "$WORK/a"
  [ "$RC" -ne 0 ] && [ "$MARKER" = "<none>" ] && grn "A off-main bare install refused (rc=$RC, nothing installed)" \
    || red "A off-main bare install should refuse without installing (rc=$RC marker=$MARKER)"

  # A message names both escape hatches.
  ( cd "$WORK/a"; KJT_TEST_OUT=/dev/null bash install.sh --provider testprov 2>&1 >/dev/null || true ) \
    | grep -q -- "--from-main" && grn "A refusal names --from-main" || red "A refusal must name --from-main"

  # B. off-main + --allow-branch INSTALLS this branch's (FEATURE) bytes.
  make_repo "$REPO/install.sh" "$WORK/b"
  ( cd "$WORK/b"; git checkout -q feature )
  run "$WORK/b" --allow-branch
  [ "$RC" -eq 0 ] && [ "$MARKER" = "FEATURE" ] && grn "B --allow-branch installs the branch bytes (FEATURE)" \
    || red "B --allow-branch should install FEATURE (rc=$RC marker=$MARKER)"

  # C. off-main + --from-main installs MAIN bytes (branch-state-immune, via a worktree).
  make_repo "$REPO/install.sh" "$WORK/c"
  ( cd "$WORK/c"; git checkout -q feature )
  run "$WORK/c" --from-main
  [ "$RC" -eq 0 ] && [ "$MARKER" = "MAIN" ] && grn "C --from-main installs MAIN bytes off a feature branch" \
    || red "C --from-main should install MAIN (rc=$RC marker=$MARKER)"
  # ...and it left NO dangling worktree behind.
  ( cd "$WORK/c"; [ "$(git worktree list | wc -l | tr -d ' ')" = "1" ] ) \
    && grn "C --from-main cleaned up its worktree" || red "C --from-main leaked a worktree"

  # D. on main, a bare install proceeds and installs MAIN bytes.
  make_repo "$REPO/install.sh" "$WORK/d"    # already on main
  run "$WORK/d"
  [ "$RC" -eq 0 ] && [ "$MARKER" = "MAIN" ] && grn "D bare install on main proceeds (MAIN)" \
    || red "D bare install on main should proceed with MAIN (rc=$RC marker=$MARKER)"

  # E. a NON-git checkout (packaged release) is exempt — the bytes ARE the release.
  make_repo "$REPO/install.sh" "$WORK/e"
  ( cd "$WORK/e"; git checkout -q feature )
  rm -rf "$WORK/e/.git"                      # strip git → packaged install
  run "$WORK/e"
  [ "$RC" -eq 0 ] && [ "$MARKER" = "FEATURE" ] && grn "E non-git install is exempt (installs present bytes)" \
    || red "E non-git install should proceed (rc=$RC marker=$MARKER)"

# ───────────────── mutation: prove the guard is what refused ─────────────────
else
  echo "install_rollout_test — MUTATION (guard neutered; A must now INSTALL instead of refusing)"
  # Neuter branch_guard to an immediate return, leaving everything else intact.
  mut="$WORK/install.mutated.sh"
  sed 's/^branch_guard() {$/branch_guard() { return 0;/' "$REPO/install.sh" > "$mut"
  make_repo "$mut" "$WORK/m"
  ( cd "$WORK/m"; git checkout -q feature )
  run "$WORK/m"
  # With the guard gone, the bare off-main install silently proceeds with FEATURE bytes — exactly
  # the defect. If this does NOT happen, scenario A above proves nothing.
  [ "$RC" -eq 0 ] && [ "$MARKER" = "FEATURE" ] && grn "mutation: neutered guard installs FEATURE (A discriminates)" \
    || red "mutation: neutered guard should have installed FEATURE (rc=$RC marker=$MARKER)"
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]

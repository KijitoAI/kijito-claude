#!/usr/bin/env bash
# Does this machine RUN what this repo SHIPS?
#
# WHY THIS EXISTS. On 2026-07-29 four of nine scripts had drifted between the repo and ~/.claude, with
# the INSTALLED copy ahead by 3 days to 5 weeks — improvements that existed only in an un-versioned
# location. The published packages (npx kijito-claude / pipx run kijito-claude) therefore shipped
# months-old behaviour, and nothing anywhere reported it: lc_test.sh tested the installed copies, so a
# drifted install looked like a passing repo.
#
# Two ways drift happens, and this check names which one you have:
#   • INSTALLED NEWER  → someone edited ~/.claude directly. The edit is real work and is not in git;
#                        copy it back into scripts/ and commit it, or it dies with the machine.
#   • REPO NEWER       → the repo moved and this machine was never re-installed. Run ./install.sh.
# "A merge does not move your local repo, and a pull does not install."
#
# Exit: 0 = in sync (or nothing installed → SKIP), 1 = drift found.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${KIJITO_INSTALL_DIR:-$HOME/.claude}"
drift=0; same=0; missing=0

if [ ! -d "$DEST" ]; then
  echo "SKIP: no install at $DEST — nothing to compare (this is normal in CI)."
  exit 0
fi

# Report which side is newer, so the operator knows which direction to fix.
newer() {
  local a="$1" b="$2" remediation="${3:-./install.sh}" ta tb
  ta=$(stat -f %m "$a" 2>/dev/null || stat -c %Y "$a" 2>/dev/null || echo 0)
  tb=$(stat -f %m "$b" 2>/dev/null || stat -c %Y "$b" 2>/dev/null || echo 0)
  if [ "$ta" -gt "$tb" ]; then echo "REPO NEWER      → this machine is stale; run $remediation"
  elif [ "$tb" -gt "$ta" ]; then echo "INSTALLED NEWER → un-versioned work; copy into scripts/ and COMMIT it"
  else echo "same mtime, different bytes"; fi
}

echo "== claude scripts: $REPO/providers/claude/scripts  vs  $DEST =="
for s in "$REPO"/providers/claude/scripts/*.sh; do
  n=$(basename "$s"); i="$DEST/$n"
  if [ ! -f "$i" ]; then printf "  MISSING  %-26s not installed\n" "$n"; missing=$((missing+1)); continue; fi
  if [ "$(shasum -a 256 "$s" | cut -d' ' -f1)" = "$(shasum -a 256 "$i" | cut -d' ' -f1)" ]; then
    printf "  ok       %s\n" "$n"; same=$((same+1))
  else
    printf "  DRIFT    %-26s %s\n" "$n" "$(newer "$s" "$i")"; drift=$((drift+1))
  fi
done

echo "== claude skills: $REPO/providers/claude/skills  vs  $DEST/skills =="
for d in "$REPO"/providers/claude/skills/*/; do
  n=$(basename "$d"); i="$DEST/skills/$n/SKILL.md"
  [ -f "$d/SKILL.md" ] || continue
  if [ ! -f "$i" ]; then printf "  MISSING  %-26s not installed\n" "$n"; missing=$((missing+1)); continue; fi
  if [ "$(shasum -a 256 "$d/SKILL.md" | cut -d' ' -f1)" = "$(shasum -a 256 "$i" | cut -d' ' -f1)" ]; then
    printf "  ok       %s\n" "$n"; same=$((same+1))
  else
    printf "  DRIFT    %-26s %s\n" "$n" "$(newer "$d/SKILL.md" "$i")"; drift=$((drift+1))
  fi
done

# The codex provider installs its skills to ~/.codex/skills. This lane is why drift_test exists:
# codex's two skills lived ONLY here, unversioned, and were the acute rescue in the 2026-07-30 fold.
CODEX_SKILLS="${KIJITO_CODEX_SKILLS_DIR:-$HOME/.codex/skills}"
if [ -d "$CODEX_SKILLS" ]; then
  echo "== codex skills: $REPO/providers/codex/skills  vs  $CODEX_SKILLS =="
  for d in "$REPO"/providers/codex/skills/*/; do
    n=$(basename "$d"); i="$CODEX_SKILLS/$n/SKILL.md"
    [ -f "$d/SKILL.md" ] || continue
    if [ ! -f "$i" ]; then printf "  MISSING  %-26s not installed\n" "$n"; missing=$((missing+1)); continue; fi
    if [ "$(shasum -a 256 "$d/SKILL.md" | cut -d' ' -f1)" = "$(shasum -a 256 "$i" | cut -d' ' -f1)" ]; then
      printf "  ok       %s\n" "$n"; same=$((same+1))
    else
      printf "  DRIFT    %-26s %s\n" "$n" "$(newer "$d/SKILL.md" "$i")"; drift=$((drift+1))
    fi
  done
else
  echo "== codex skills: SKIP (no $CODEX_SKILLS on this machine) =="
fi

# The executable Codex wake runtime is at least as important as its prose skills. A previous version
# of this gate compared only ~/.codex/skills, so an old flat controller could stay live while the
# repository shipped repaired nested bytes and the gate still reported green.
CODEX_RUNTIME="${KIJITO_CODEX_INSTALL_ROOT:-$HOME/.local/share/codex-kijito-hive}"
if [ -d "$CODEX_RUNTIME" ]; then
  echo "== codex wake runtime: $REPO/providers  vs  $CODEX_RUNTIME =="
  while IFS='|' read -r label source installed; do
    if [ ! -f "$installed" ]; then
      printf "  DRIFT    %-26s installed runtime is missing this repo byte\n" "$label"
      drift=$((drift+1)); continue
    fi
    if [ "$(shasum -a 256 "$source" | cut -d' ' -f1)" = "$(shasum -a 256 "$installed" | cut -d' ' -f1)" ]; then
      printf "  ok       %s\n" "$label"; same=$((same+1))
    else
      printf "  DRIFT    %-26s %s\n" "$label" "$(newer "$source" "$installed" "./install.sh --provider codex --upgrade")"; drift=$((drift+1))
    fi
  done <<EOF
controller.mjs|$REPO/providers/codex/controller.mjs|$CODEX_RUNTIME/codex/controller.mjs
wake-core.mjs|$REPO/providers/_shared/wake-core.mjs|$CODEX_RUNTIME/_shared/wake-core.mjs
cli.mjs|$REPO/providers/codex/cli.mjs|$CODEX_RUNTIME/cli.mjs
EOF
else
  echo "== codex wake runtime: SKIP (no $CODEX_RUNTIME on this machine) =="
fi

# Files present in the install but with no repo counterpart. NOT drift — an install dir legitimately
# holds unrelated local tools — but worth naming, since an artifact with no upstream anywhere is
# exactly how the 2026-07-29 gap arose. Reported, never failed on.
echo "== installed-only (no repo counterpart — FYI, not a failure) =="
found_only=0
for i in "$DEST"/*.sh; do
  [ -f "$i" ] || continue
  n=$(basename "$i")
  [ -f "$REPO/providers/claude/scripts/$n" ] || { printf "  local-only  %s\n" "$n"; found_only=1; }
done
[ "$found_only" -eq 0 ] && echo "  (none)"

echo
echo "RESULT: $same in sync, $drift drifted, $missing missing"
if [ "$drift" -gt 0 ]; then
  echo "FAIL: repo and install disagree. Fix the DIRECTION named above — do not assume the repo is right."
  exit 1
fi
echo "PASS: this machine runs what the repo ships."

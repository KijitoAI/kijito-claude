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

# Modification time as a bare epoch integer, on both stat dialects.
#
# ⚠️ `stat -f %m || stat -c %Y` LOOKS like a correct portability fallback and is not, because the
# two dialects do not merely spell the flag differently — THEY GIVE `-f` OPPOSITE MEANINGS. On BSD
# /macOS `-f` is a format string; on GNU/Linux `-f` means "report the FILESYSTEM", which SUCCEEDS
# and prints a multi-line block. So on Linux the first branch exits 0, the `||` never fires, and
# the caller compares a paragraph of text with `-gt`: a shell error per call, and every drifted
# file reported as "same mtime, different bytes".
#
# ★ The failure is silent in the direction that costs the most: "same mtime" is the ONE verdict
# that tells the operator nothing, so a test whose whole job is to say WHICH SIDE TO FIX printed
# the unactionable answer on every Linux host. The lesson is the general one — an exit code proves
# a command RAN, never that it answered the question you asked. VALIDATE THE RESULT, not the status.
_mtime() {
  local t
  t=$(stat -c %Y "$1" 2>/dev/null)                          # GNU/Linux
  case "$t" in ''|*[!0-9]*) t=$(stat -f %m "$1" 2>/dev/null) ;; esac   # BSD/macOS
  case "$t" in ''|*[!0-9]*) t=0 ;; esac                     # neither → refuse to guess
  printf '%s' "$t"
}

# Report which side is newer, so the operator knows which direction to fix.
newer() {
  local a="$1" b="$2" ta tb
  ta=$(_mtime "$a")
  tb=$(_mtime "$b")
  # 0 means _mtime could not read the timestamp on this host. Say so rather than reporting the
  # two files as equally aged, which is what comparing 0 with 0 would otherwise assert.
  if [ "$ta" = 0 ] || [ "$tb" = 0 ]; then
    echo "bytes differ (mtime unreadable here — compare by hand)"; return
  fi
  # ⚠️ MTIME IS EVIDENCE, NOT A VERDICT — and it is biased in one direction. `install`/`cp` stamp
  # the destination with the CURRENT time, so the installed copy is newer than the repo after ANY
  # install, including one that deployed OLDER content (e.g. `npx kijito-claude` pulling the last
  # published release onto a box whose checkout is ahead of it). Measured 2026-07-31: exactly that
  # host reported "INSTALLED NEWER → un-versioned work; COMMIT it" for two skills whose repo
  # versions were in fact the newer ones — advice that would have overwritten current work with
  # stale published content.
  #
  # ★ So the honest output names the observation and the check that settles it, instead of a
  # confident direction the timestamp cannot support. A wrong direction is worse than no direction:
  # this test exists to be obeyed, and the remedy it names is destructive in one of the two cases.
  if [ "$ta" -gt "$tb" ]; then
    echo "repo mtime newer  → likely this machine is stale; run ./install.sh"
  elif [ "$tb" -gt "$ta" ]; then
    echo "install mtime newer → INCONCLUSIVE (any install refreshes it); check \`git log -1 --\` on the repo file before copying anything back"
  else
    echo "same mtime, different bytes"
  fi
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

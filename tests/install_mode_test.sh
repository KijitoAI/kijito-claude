#!/usr/bin/env bash
# Does the installer leave ~/.claude/settings.json owner-only?
#
# WHY THIS EXISTS. settings.json's `env` block is where KIJITO_API_TOKEN lives — a bearer token for
# the entire account's memory graph. Published 0.1.2 wrote that file through `jq ... > tmp` followed
# by `mv tmp settings.json`, which creates tmp under the AMBIENT UMASK; mv then carried that mode
# onto the live file. An existing 0600 came out 0664 on a umask-002 host, 0644 on umask-022. Found
# 2026-07-31 by installing the PUBLISHED package as an outsider on a fresh box, not by reading this
# repo — the defect is invisible in the source unless you are already thinking about umask.
#
# ⚠️ THE PART THAT MAKES IT MORE THAN A ONE-LINE BUG: the installer is advertised as safe to re-run
# on any machine, and re-running is the normal path. So a user who noticed and ran `chmod 600` lost
# the fix at their next install, silently. A defect that RE-ARMS after remediation needs a test, not
# a fix — which is what this file is.
#
# ⚠️ AND WHY A UNIT TEST OF THE MERGE WOULD NOT HAVE CAUGHT IT: the jq merge was, and is, correct.
# Every assertion anyone would naturally write about this code — is the JSON valid, are the keys
# added, is anything clobbered — passes on the broken version. The property that broke lives in the
# FILE METADATA, which no content assertion can see. So this test asserts modes, and asserts them
# after running the REAL installer end to end rather than a re-implementation of its logic.
#
#   bash tests/install_mode_test.sh              # run the checks
#   bash tests/install_mode_test.sh --mutation   # ALSO prove the checks can fail (see below)
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0; fail=0

red() { printf "  FAIL  %s\n" "$1"; fail=$((fail+1)); }
grn() { printf "  ok    %s\n" "$1"; pass=$((pass+1)); }

# BSD/macOS stat and GNU stat disagree on the flag for "mode as octal". Try GNU, fall back to BSD.
# Order matters only for the error message; both hosts are in scope (macOS dev, Linux CI/VM seats).
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed — the installer requires it."; exit 0; }

# Run the installer against a throwaway HOME under a DELIBERATELY PERMISSIVE UMASK.
#
# ⚠️ 002 is not a contrived value — it is the default on Ubuntu and on any host with per-user
# groups, and it is what the reporting host actually had. Running this suite under the tester's
# own umask would make the result depend on who ran it: on a umask-077 box the BROKEN installer
# produces 0600 by accident and this test passes while shipping the bug. Pinning the umask is what
# makes the check a property of the installer rather than a property of the machine.
run_install() {  # $1 = installer path, $2 = HOME dir
  ( umask 002; HOME="$2" bash "$1" >/dev/null 2>&1 )
}

# One full scenario. $1 = installer to exercise, $2 = label for messages.
# Returns 0 if every mode assertion held, 1 otherwise — so the mutation run can require failure.
check_installer() {
  local installer="$1" label="$2" bad=0
  local tmp; tmp="$(mktemp -d)" || { red "$label: mktemp failed"; return 1; }
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  # ---- scenario A: a PRE-EXISTING 0600 settings.json carrying a token ----
  # This is the case that actually bit a user: the file was already correct, and installing
  # made it worse. A test that only covered fresh installs would have missed it.
  mkdir -p "$tmp/a/.claude"
  printf '%s\n' '{"env":{"KIJITO_API_TOKEN":"kjt_TESTVALUE_not_a_real_token"}}' > "$tmp/a/.claude/settings.json"
  chmod 0600 "$tmp/a/.claude/settings.json"
  run_install "$installer" "$tmp/a"

  local m; m="$(mode_of "$tmp/a/.claude/settings.json")"
  if [ "$m" = "600" ]; then grn "$label: existing 0600 settings.json stays 0600 (umask 002)"
  else red "$label: settings.json is $m after install, expected 600 — token is readable by other local users"; bad=1; fi

  # The backup is a byte-identical copy of the same secret. `cp` without -p derives the new file's
  # mode from the source, so this happens to be right today — but "happens to be right" is exactly
  # what the main bug was, so assert it rather than trusting the coincidence.
  local b; b="$(ls "$tmp/a/.claude"/settings.json.bak.* 2>/dev/null | head -1)"
  if [ -z "$b" ]; then red "$label: no backup written — the installer promises one"; bad=1
  else
    m="$(mode_of "$b")"
    if [ "$m" = "600" ]; then grn "$label: settings.json backup is 0600"
    else red "$label: backup is $m, expected 600 — a backup of a secret is still a secret"; bad=1; fi
  fi

  # Mode is the subject here, but a fix that locked the file down by CORRUPTING it would also pass
  # the checks above. Assert the merge is still additive and the user's own key survived, so this
  # test cannot green a fix that trades one defect for a worse one.
  if jq -e '.env.KIJITO_API_TOKEN == "kjt_TESTVALUE_not_a_real_token" and .statusLine.type == "command"' \
       "$tmp/a/.claude/settings.json" >/dev/null 2>&1; then
    grn "$label: pre-existing env key preserved AND installer keys merged"
  else
    red "$label: merge no longer additive — the mode fix must not change what the file contains"; bad=1
  fi

  # ---- scenario C: an existing 0644 must be TIGHTENED, and the tightening must be VISIBLE ----
  # assay's second-operator review endorsed tightening (a settings.json holding a bearer token has
  # no legitimate other-reader) but flagged that doing it silently is wrong: the output read
  # "mode 0600" identically whether it had always been 0600 or had just been changed underneath the
  # operator. A policy decision the user cannot see is not a policy, it is a surprise.
  mkdir -p "$tmp/c/.claude"
  printf '%s\n' '{"env":{"KIJITO_API_TOKEN":"kjt_TESTVALUE_not_a_real_token"}}' > "$tmp/c/.claude/settings.json"
  chmod 0644 "$tmp/c/.claude/settings.json"
  ( umask 002; HOME="$tmp/c" bash "$installer" > "$tmp/c/out.log" 2>&1 )
  m="$(mode_of "$tmp/c/.claude/settings.json")"
  if [ "$m" = "600" ]; then grn "$label: pre-existing 0644 is tightened to 0600"
  else red "$label: 0644 settings.json left at $m — the token stays world-readable"; bad=1; fi
  if grep -q "tightened" "$tmp/c/out.log"; then grn "$label: the tightening is announced, not silent"
  else red "$label: mode changed 0644->0600 with no message — invisible policy change"; bad=1; fi

  # ---- scenario D: a SYMLINKED settings.json must be followed, not replaced ----
  # Replacing the symlink leaves the live config correct — which is why it looks fine — while
  # silently de-linking a dotfiles-managed setup AND stranding a copy of the token at the old path
  # and old mode. Same defect as the headline one, just relocated.
  mkdir -p "$tmp/d/.claude" "$tmp/d/dotfiles"
  printf '%s\n' '{"env":{"KIJITO_API_TOKEN":"kjt_TESTVALUE_not_a_real_token"}}' > "$tmp/d/dotfiles/settings.json"
  chmod 0600 "$tmp/d/dotfiles/settings.json"
  ln -s "$tmp/d/dotfiles/settings.json" "$tmp/d/.claude/settings.json"
  ( umask 002; HOME="$tmp/d" bash "$installer" >/dev/null 2>&1 )
  if [ -L "$tmp/d/.claude/settings.json" ]; then grn "$label: symlinked settings.json stays a symlink"
  else red "$label: symlink was REPLACED by a regular file — dotfiles indirection broken, token stranded at the old path"; bad=1; fi
  if jq -e '.statusLine.type == "command"' "$tmp/d/dotfiles/settings.json" >/dev/null 2>&1; then
    grn "$label: the merge was written THROUGH the symlink to its target"
  else red "$label: symlink target was not updated — the install did not take"; bad=1; fi
  m="$(mode_of "$tmp/d/dotfiles/settings.json")"
  if [ "$m" = "600" ]; then grn "$label: symlink target is 0600"
  else red "$label: symlink target is $m, expected 600"; bad=1; fi

  # ---- scenario B: NO pre-existing settings.json ----
  # A fresh install has no prior mode to preserve, so "preserve the mode" is not a sufficient fix:
  # the file must be created locked down. Without this case a fix that only copies the old mode
  # would pass while every brand-new install shipped a world-readable token file.
  mkdir -p "$tmp/b/.claude"
  run_install "$installer" "$tmp/b"
  m="$(mode_of "$tmp/b/.claude/settings.json")"
  if [ "$m" = "600" ]; then grn "$label: freshly-created settings.json is 0600 (umask 002)"
  else red "$label: fresh settings.json is $m, expected 600"; bad=1; fi

  # A fresh install used to leave a settings.json.bak.<ts> containing `{}` — noise that implies a
  # prior config which never existed, and makes the backup list harder to read exactly when it
  # matters. Assert the absence.
  if ls "$tmp/b/.claude"/settings.json.bak.* >/dev/null 2>&1; then
    red "$label: fresh install wrote a backup of a file that did not exist"; bad=1
  else grn "$label: fresh install writes no empty backup"; fi

  return $bad
}

echo "installer mode checks (settings.json must stay owner-only):"
check_installer "$REPO/install.sh" "install.sh"

# --- mutation: prove the checks above are capable of failing ---------------------------------
#
# ⚠️ WITHOUT THIS, A GREEN RUN IS UNINTERPRETABLE. If the assertions were mis-wired — wrong path,
# a stat that returns empty on this host, an installer that silently exited before writing anything
# — every check would report ok and the suite would certify the exact defect it exists to catch.
# So: strip the chmod lines from a COPY of the real installer, run the SAME checks against it, and
# require them to FAIL. This mutates the shipped fix, not a restatement of it, so it also fails if
# someone deletes the fix and leaves this test in place.
if [ "${1:-}" = "--mutation" ]; then
  echo
  echo "mutation (installer with its chmods removed MUST fail the checks above):"
  mtmp="$(mktemp -d)"
  cp -R "$REPO"/. "$mtmp/" 2>/dev/null
  # Remove only the chmods guarding settings.json + its backup, leaving everything else intact.
  # `-i.bak` with an explicit suffix is the one form that behaves the same on GNU and BSD sed.
  sed -i.bak -e '/chmod 0600 "\$SET/d' -e '/chmod 0600 "\$BAK"/d' \
    "$mtmp/providers/claude/install.sh"
  if grep -q 'chmod 0600 "\$SET\.tmp"' "$mtmp/providers/claude/install.sh"; then
    red "mutation did not apply — the sed no longer matches the installer, so this direction proves nothing"
  else
    # ⚠️ The mutant is SUPPOSED to fail, so its red/grn calls must not reach the suite's tally.
    # check_installer runs in this same shell (redirecting its output hides the noise but not the
    # counter writes), so the first version of this file reported "failed: 3" on a fully-green run
    # — a false FAIL manufactured by the check that exists to prevent false results. Snapshot the
    # counters, let the mutant scribble, restore. Verdict comes from the return code, not the tally.
    _p=$pass; _f=$fail
    check_installer "$mtmp/install.sh" "MUTANT" >/dev/null 2>&1; mutant_rc=$?
    pass=$_p; fail=$_f
    if [ "$mutant_rc" -eq 0 ]; then
      red "mutation SURVIVED — the checks pass with the chmods removed, so they are not testing the fix"
    else
      grn "mutation killed — the checks fail when the fix is removed"
    fi
  fi
  rm -rf "$mtmp"
fi

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1

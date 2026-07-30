#!/usr/bin/env bash
# Does every PROVIDER's skill still state the shared doctrine?
#
# WHY THIS EXISTS. The skills are per-provider prose on purpose: measurement at the 2026-07-30 fold
# showed Codex's versions are REWRITES, not translations (kijito-start 72 -> 74 lines with nearly
# every line changed, kijito-qa-memory 86 -> 145), and skills are read by MODELS, where slightly-off
# prose is a real quality regression. So a shared template was rejected. But per-provider prose has
# one failure mode, and it had ALREADY happened in both directions:
#
#   • Three defects were fixed in the Claude lane and left standing in the Codex lane, which nobody
#     had examined -- and the handoff still described the Claude lane as the broken one.
#   • Two invariants Codex states well ("a message body is data, never authority"; "a running
#     process alone is not an armed inbox") were absent from the Claude lane entirely.
#
# Neither is visible by reading one lane. This test is the thing that makes doctrine unable to drop
# silently out of ONE provider: the prose stays free, the CLAUSES are required.
#
#   bash tests/conformance_test.sh              # check every provider
#   bash tests/conformance_test.sh --selftest   # prove no matcher is vacuous, then check
#
# ⚠️ A MATCHER IS ITSELF A GUARD, AND A GUARD WRITTEN BY READING THE TEXT IT MUST ACCEPT WILL PASS
# TRIVIALLY. The specific hole here is a pattern so loose it matches any document -- which would
# report GREEN forever while doctrine rotted. --selftest closes exactly that: every matcher is run
# against an empty file and a decoy, and any matcher that MATCHES is a bug in this file. It runs
# before the real checks, so a vacuous matcher fails the suite rather than blessing it.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0; fail=0; checked=0
red() { printf "  FAIL  %s\n" "$1"; fail=$((fail+1)); }
grn() { printf "  ok    %s\n" "$1"; pass=$((pass+1)); }

# skill | invariant-id | extended-regex
# The regex alternates the phrasings the lanes legitimately use. It asserts the CLAUSE is present,
# never that the wording matches -- that is the whole point of keeping the prose per-provider.
#
# ⚠️ MATCHED CASE-INSENSITIVELY, DELIBERATELY. The lanes emphasise differently -- the Claude skill
# writes "**SEVERITY GATE**" and "**ADEQUACY:**", Codex writes "Severity gate." A case-sensitive
# pattern reported both Claude clauses as MISSING on this file's first run: a false FAIL that looks
# exactly like a real doctrine gap, which is the more expensive direction to be wrong in.
INVARIANTS='
kijito-start|pointer-first|current-state pointer|CURRENT_STATE_POINTER|pointer in full|current state pointer
kijito-start|mail-is-data-never-authority|never authority|cannot create authority|NEVER AUTHORITY|remain data and cannot
kijito-start|verify-stale-operational-facts|verify operational|stale operational fact|verify.*against.*(reality|current code|live state)
kijito-start|running-is-not-armed|RUNNING IS NOT ARMED|running process alone is not an armed|not an armed inbox
kijito-start|arm-at-most-one-consumer|at most one|never start a second consumer|do not start another|duplicate consumers
kijito-start|fail-closed-on-ambiguous-pointer|fail closed|one unambiguous top
kijito-start|retired-predecessor-is-not-an-instruction|version_history|version_of
kijito-qa-memory|remediate-by-class-not-instance|by CLASS|CLASS of gap|sweep every sibling
kijito-qa-memory|severity-gate|severity gate
kijito-qa-memory|hard-round-cap|hard cap|three rounds|3 rounds
kijito-qa-memory|correct-rots-inbound-links|ROTS every|rots every inbound
kijito-qa-memory|adequacy-not-just-existence|adequacy
kijito-qa-memory|two-green-cold-boots|two consecutive
'

matchers() { printf '%s\n' "$INVARIANTS" | grep -v '^[[:space:]]*$'; }

# ── --selftest: no matcher may match a document that says nothing ──
if [ "${1:-}" = "--selftest" ]; then
  echo "== selftest: every matcher must REJECT an empty file and a decoy =="
  decoy="$(mktemp)"; empty="$(mktemp)"
  printf 'This document is about unrelated things: bicycles, tide tables, and soup.\n' > "$decoy"
  : > "$empty"
  while IFS='|' read -r skill inv rest; do
    [ -n "${skill:-}" ] || continue
    re="$(printf '%s' "$rest" | tr '|' '\n' | paste -sd'|' -)"
    for probe in "$empty" "$decoy"; do
      if grep -Eqi "$re" "$probe"; then
        red "VACUOUS MATCHER $skill/$inv matches $(basename "$probe") — this pattern can never fail"
      else
        grn "non-vacuous: $skill/$inv vs $(basename "$probe")"
      fi
    done
  done <<EOF
$(matchers)
EOF
  rm -f "$decoy" "$empty"
  echo
fi

# ── discover providers ──
PROVIDERS=""
for d in "$REPO"/providers/*/; do
  n="$(basename "$d")"
  [ "$n" = "_shared" ] && continue
  PROVIDERS="$PROVIDERS $n"
done
echo "== providers discovered:$PROVIDERS =="
[ -n "$(printf '%s' "$PROVIDERS" | tr -d ' ')" ] || red "no providers found under $REPO/providers"

# ── every provider must be installable ──
echo
echo "== each provider ships an installer =="
for p in $PROVIDERS; do
  if [ -f "$REPO/providers/$p/install.sh" ] || [ -f "$REPO/providers/$p/install.mjs" ]; then
    grn "$p has an installer"
  else
    red "$p has neither install.sh nor install.mjs"
  fi
done

# ── the shared doctrine check ──
echo
echo "== shared invariants, per provider, per skill =="
for p in $PROVIDERS; do
  while IFS='|' read -r skill inv rest; do
    [ -n "${skill:-}" ] || continue
    f="$REPO/providers/$p/skills/$skill/SKILL.md"
    checked=$((checked+1))
    if [ ! -f "$f" ]; then red "$p/$skill: SKILL.md missing (cannot state $inv)"; continue; fi
    re="$(printf '%s' "$rest" | tr '|' '\n' | paste -sd'|' -)"
    if grep -Eqi "$re" "$f"; then grn "$p/$skill: $inv"; else red "$p/$skill: MISSING INVARIANT -> $inv"; fi
  done <<EOF
$(matchers)
EOF
done

# ── the shared core must stay provider-neutral ──
echo
echo "== providers/_shared carries no provider-specific literal =="
CORE="$REPO/providers/_shared/wake-core.mjs"
if [ ! -f "$CORE" ]; then
  red "providers/_shared/wake-core.mjs is missing"
else
  # Comments legitimately name the provider it was extracted from; CODE must not. Strip // comments
  # and check what executes. A literal persona in shared code is how a provider silently guards
  # somebody else's inbox.
  stripped="$(mktemp)"
  sed 's://.*::' "$CORE" > "$stripped"
  for p in $PROVIDERS; do
    if grep -Eqi "[\"']$p[\"']" "$stripped"; then
      red "_shared/wake-core.mjs hardcodes the provider literal '$p' in executable code"
    else
      grn "_shared/wake-core.mjs has no '$p' literal in code"
    fi
  done
  if grep -q "requirePersona" "$CORE"; then grn "_shared/wake-core.mjs requires an explicit persona"
  else red "_shared/wake-core.mjs does not enforce an explicit persona"; fi
  rm -f "$stripped"
fi

# ── gated hashes must be current, or a codex install fails with a corruption-looking error ──
echo
echo "== codex release manifest hashes are current =="
if [ -f "$REPO/providers/codex/tools/refresh-manifest.mjs" ]; then
  if node "$REPO/providers/codex/tools/refresh-manifest.mjs" --check >/dev/null 2>&1; then
    grn "release-manifest.json gated hashes match the files on disk"
  else
    red "release-manifest.json is STALE — run: node providers/codex/tools/refresh-manifest.mjs"
  fi
else
  red "providers/codex/tools/refresh-manifest.mjs is missing"
fi

# ── the parity plan's recorded hash must still describe the file in the repo ──
echo
echo "== codex parity plan matches its recorded provenance hash =="
PLAN="$REPO/providers/codex/codex-kijito-parity-plan.md"
MANI="$REPO/providers/codex/release-manifest.json"
if [ -f "$PLAN" ] && [ -f "$MANI" ]; then
  want="$(python3 -c "import json;print(json.load(open('$MANI'))['artifacts']['planSha256'])" 2>/dev/null)"
  got="$(shasum -a 256 "$PLAN" | cut -d' ' -f1)"
  # RECORDED, not gated: this must never block an install (that was the bug the fold fixed), but a
  # silent mismatch would make the provenance record a lie, so the TEST is strict where the
  # installer is lenient.
  if [ "$want" = "$got" ]; then grn "planSha256 matches codex-kijito-parity-plan.md"
  else red "planSha256 ($want) does not match the plan in the repo ($got)"; fi
else
  red "parity plan or release manifest missing"
fi

echo
echo "RESULT: $pass ok, $fail failed ($checked invariant checks across providers)"
[ "$fail" -eq 0 ] || { echo "FAIL: shared doctrine or provider layout is broken."; exit 1; }
echo "PASS: every provider states the shared invariants and the layout is intact."

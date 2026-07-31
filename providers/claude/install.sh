#!/usr/bin/env bash
# kijito-claude — the CLAUDE provider's installer. Deploys the toolkit into ~/.claude and merges
# settings.json. Idempotent + non-destructive: backs up settings.json, jq-merges keys (no clobber),
# de-dups the hook. Also the cross-machine/fleet installer: clone the repo on any box and run this.
#
# Normally reached through the repo-root dispatcher (`./install.sh`, which defaults to this
# provider); running it directly works too. Its assets are resolved relative to THIS file, which is
# why moving it into providers/claude/ during the 2026-07-30 provider split needed no path edits.
set -euo pipefail
PROVIDER_ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required."; exit 1; }
command -v tmux >/dev/null 2>&1 || echo "WARN: tmux not found — armed-pane autonomy + auto-send need tmux. (Context self-check works without it.)"

mkdir -p "$DEST/skills" "$DEST/.lifecycle"

# 1) scripts → ~/.claude (executable)
for s in "$PROVIDER_ROOT"/scripts/*.sh; do install -m 0755 "$s" "$DEST/$(basename "$s")"; done
echo "✓ scripts installed → $DEST"

# 2) skills (optional helpers — every skill in skills/ gets deployed)
for d in "$PROVIDER_ROOT"/skills/*/; do
  name="$(basename "$d")"
  [ -f "$d/SKILL.md" ] || continue
  mkdir -p "$DEST/skills/$name"
  install -m 0644 "$d/SKILL.md" "$DEST/skills/$name/SKILL.md"
  echo "✓ skill: $name"
done

# 2b) the CLAUDE.md doctrine snippet — copied alongside so npx/pipx users (who never cloned
# the repo) still have it to paste into ~/.claude/CLAUDE.md.
if [ -f "$PROVIDER_ROOT/CLAUDE.md.snippet" ]; then
  install -m 0644 "$PROVIDER_ROOT/CLAUDE.md.snippet" "$DEST/kijito-claude.CLAUDE.md.snippet"
  echo "✓ doctrine snippet → $DEST/kijito-claude.CLAUDE.md.snippet"
fi

# 3) settings.json — merge statusLine / totalTokensReminder / env / SessionStart hook (idempotent)
#
# ⚠️ MODE IS PART OF THE CONTRACT, NOT A DETAIL. This file's `env` block is where a
# KIJITO_API_TOKEN lives — a bearer token for the whole account's memory graph — so it must be
# owner-only. Every write below goes through a file we chmod 0600 BEFORE it becomes settings.json.
# The defect this guards: `jq ... > tmp` then `mv tmp settings.json` creates tmp under the AMBIENT
# UMASK and mv carries that mode over, silently downgrading an existing 0600 to 0664 (umask 002) or
# 0644 (umask 022). Because the installer is advertised as safe to re-run, it re-armed on every
# run — a user who fixed the mode by hand lost the fix at the next install, with no warning.
SET="$DEST/settings.json"
if [ ! -f "$SET" ]; then
  # Create it locked down FIRST, then write — never the other way round, or the token-bearing
  # file exists world-readable for the window in between.
  : > "$SET"; chmod 0600 "$SET"; echo '{}' > "$SET"
fi
BAK="$SET.bak.$(date +%Y%m%d%H%M%S)"
cp "$SET" "$BAK"; chmod 0600 "$BAK"   # a backup of a secret is still a secret
HOOK=$(jq -n --arg cmd "bash $DEST/session-catchup-hint.sh" \
  '{matcher:"startup|clear|compact", hooks:[{type:"command", command:$cmd}]}')
jq --arg home "$DEST" --argjson hook "$HOOK" '
  .statusLine = {type:"command", command:("bash " + $home + "/statusline-context.sh"), padding:0}
  | .totalTokensReminder = (.totalTokensReminder // "countdown")
  | .env = ((.env // {}) + {KIJITO_AUTOCATCHUP_DELAY: ((.env.KIJITO_AUTOCATCHUP_DELAY) // "4.0")})
  | .hooks = (.hooks // {})
  | .hooks.SessionStart = (
      ((.hooks.SessionStart // [])
        | map(select([ (.hooks[]?.command // "") ] | any(test("session-catchup-hint")) | not)))
      + [$hook] )
' "$SET" > "$SET.tmp"
jq -e . "$SET.tmp" >/dev/null
# chmod the temp file BEFORE the rename, not settings.json after it: mv is atomic, so there is
# never a moment where the live file exists with the wrong mode. Doing it after would leave a
# readable window, and would silently do nothing at all if the mv failed.
chmod 0600 "$SET.tmp"
mv "$SET.tmp" "$SET"
echo "✓ settings.json merged, mode 0600 (backup: $SET.bak.*)"

echo
echo "Next: add the doctrine snippet to your ~/.claude/CLAUDE.md (context self-check + session-start"
echo "catch-up + self-clear gate). It's at $DEST/kijito-claude.CLAUDE.md.snippet"
echo "New sessions pick up the hook + statusline; restart a running session to apply."
echo "Verify context self-check now:  ~/.claude/myctx.sh"

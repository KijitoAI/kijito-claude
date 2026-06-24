#!/usr/bin/env bash
# kijito-claude installer — deploys the toolkit into ~/.claude and merges settings.json.
# Idempotent + non-destructive: backs up settings.json, jq-merges keys (no clobber), de-dups the hook.
# Also the cross-machine/fleet installer: clone the repo on any box and run this.
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required."; exit 1; }
command -v tmux >/dev/null 2>&1 || echo "WARN: tmux not found — armed-pane autonomy + auto-send need tmux. (Context self-check works without it.)"

mkdir -p "$DEST/skills" "$DEST/.lifecycle"

# 1) scripts → ~/.claude (executable)
for s in "$REPO"/scripts/*.sh; do install -m 0755 "$s" "$DEST/$(basename "$s")"; done
echo "✓ scripts installed → $DEST"

# 2) skills (optional helpers — every skill in skills/ gets deployed)
for d in "$REPO"/skills/*/; do
  name="$(basename "$d")"
  [ -f "$d/SKILL.md" ] || continue
  mkdir -p "$DEST/skills/$name"
  install -m 0644 "$d/SKILL.md" "$DEST/skills/$name/SKILL.md"
  echo "✓ skill: $name"
done

# 2b) the CLAUDE.md doctrine snippet — copied alongside so npx/pipx users (who never cloned
# the repo) still have it to paste into ~/.claude/CLAUDE.md.
if [ -f "$REPO/CLAUDE.md.snippet" ]; then
  install -m 0644 "$REPO/CLAUDE.md.snippet" "$DEST/kijito-claude.CLAUDE.md.snippet"
  echo "✓ doctrine snippet → $DEST/kijito-claude.CLAUDE.md.snippet"
fi

# 3) settings.json — merge statusLine / totalTokensReminder / env / SessionStart hook (idempotent)
SET="$DEST/settings.json"; [ -f "$SET" ] || echo '{}' > "$SET"
cp "$SET" "$SET.bak.$(date +%Y%m%d%H%M%S)"
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
mv "$SET.tmp" "$SET"
echo "✓ settings.json merged (backup: $SET.bak.*)"

echo
echo "Next: add the doctrine snippet to your ~/.claude/CLAUDE.md (context self-check + session-start"
echo "catch-up + self-clear gate). It's at $DEST/kijito-claude.CLAUDE.md.snippet"
echo "New sessions pick up the hook + statusline; restart a running session to apply."
echo "Verify context self-check now:  ~/.claude/myctx.sh"

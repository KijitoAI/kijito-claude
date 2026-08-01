# Wiring the backup heartbeat

`heartbeat-watchdog.sh` is installed to `~/.claude/` but is **not started for you** — it needs a pane
id, and only you know which pane is your armed autonomous session.

## Linux (systemd user unit)

```sh
cp kijito-heartbeat@.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kijito-heartbeat@1     # for pane %1
```

⚠️ **Instantiate with the pane number WITHOUT its leading `%`.** systemd treats `%` as its own
specifier prefix, so `kijito-heartbeat@%1` is mangled to `\x251` and the watchdog then polls a pane
that cannot exist — it logs `HEARTBEAT_START pane=\x251`, finds nothing, and restart-loops forever.
Measured 2026-08-01. The unit rebuilds the real id as `%%%i` (a literal `%`, then the instance name).

Find your pane id with `echo $TMUX_PANE` inside the session.

## macOS (launchd)

Same script, same argument. A minimal LaunchAgent:

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>/Users/YOU/.claude/heartbeat-watchdog.sh</string>
  <string>%1</string>
</array>
<key>KeepAlive</key><true/>
```

launchd has no `%`-specifier problem, so the pane id goes in verbatim.

## Or just run it

```sh
nohup ~/.claude/heartbeat-watchdog.sh "$TMUX_PANE" >/dev/null 2>&1 &
```

Fine for a single session; it dies with the shell that started it, which is why the supervised forms
above exist.

## Checking it

`grep HEARTBEAT ~/.claude/.lifecycle/lifecycle.log`. You should see `HEARTBEAT_START` once, then
`HEARTBEAT_SKIP` lines if the pane is unarmed, and `HEARTBEAT_NUDGE` only after a full quiet window
(default 4 × 300s = 20 min of byte-identical pane output).

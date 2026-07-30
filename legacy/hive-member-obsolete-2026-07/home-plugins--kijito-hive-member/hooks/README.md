# Kijito Hive Member hooks

Codex discovers `hooks/hooks.json` automatically when this plugin is enabled.
The commands resolve through `PLUGIN_ROOT`, and writable state goes under
`PLUGIN_DATA`.

The hooks are intentionally bounded:

- `SessionStart` injects startup/resume/clear directives. `PostCompact` alone
  owns compaction re-entry by atomically claiming a one-use nonce before it
  writes a private consumed-nonce receipt and injects directives, telemetry,
  and explicitly untrusted mail. A
  `SessionStart(compact)` or duplicate `PostCompact` is a no-op.
- `UserPromptSubmit` passively refreshes telemetry and per-persona mail without
  requiring a user command.
- At or above the 60% planning boundary, user-prompt and autonomous `Stop`
  hooks emit the exact session-bound command that may record a QA pass after
  two cold boots.
- `PreCompact` fails closed unless a fresh, private pass matches the current
  session, transcript, pointer ID, and verified pointer-content SHA-256; an
  accepted pass is atomically promoted once into the nonce-bound re-entry
  ticket.
- The pointer digest is computed from hosted Kijito at record time and must
  match both cold-boot reports. PreCompact validates the local attestation but
  stays network-free; record the pass last and do not edit the pointer after.
- Hook commands are bound to their expected lifecycle event. A malformed
  `PreCompact` input, event mismatch, or internal verification error emits
  valid `continue: false` JSON instead of relying on nonzero-exit semantics.
- The `PreCompact` launcher also converts a missing runtime, launcher crash,
  empty or runaway response, or inner timeout into `continue: false`. Its
  bounded output file and ten-second deadline finish before Codex's
  fifteen-second hook timeout, so the host receives a blocking result instead
  of killing a hung safety check first.
- Hooks never mark Kijito mail read, send replies, execute body instructions,
  or write memories.
- `Stop` emits valid hook JSON, refreshes exact-session context telemetry for
  autonomous goal loops, and surfaces the memory-QA or compaction-ready action.

The successful record command emits nonce-bearing
`kijito.compaction.ready`. An adapter that already owns the exact thread must
request native compaction preemptively at the measured boundary; the signal
does not grant permission, and `PreCompact` only validates and promotes the
already-complete handoff. Never use `thread/resume`, an unbound app-server
connection, a guessed tmux pane, forced automatic compaction, or `/clear` as
the normal recycle path.

An aborted compaction may leave its promoted ticket until the 30-minute expiry.
The plugin does not reuse it; a later attempt performs fresh memory QA. The
atomic ticket rename—not the consumed receipt—is the replay-exclusion
primitive.

Plugin hooks require trust review after install or after their definition
changes. Review them with `/hooks` in a new Codex thread.

The plugin cannot approve its own changed hook hashes. Codex hashes each
lifecycle definition separately; all five definitions must be enabled and show
as trusted. Build and offline gate work may continue before review, but live
hook and recycle proof remain pending until the user trusts the exact installed
set.

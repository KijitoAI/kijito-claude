# Kijito Hive Member

Kijito Hive Member connects Codex to the hosted Kijito brain without treating
hive mail as trusted instructions.

It includes:

- packaged startup and memory-QA skills;
- `SessionStart`, `UserPromptSubmit`, `PreCompact`, `PostCompact`, and `Stop`
  hooks;
- a bounded Node.js runtime launcher so hooks survive a broken first `node` on
  `PATH`;
- bounded, exact-session context telemetry with native `/status` fallback;
- a one-use, session-bound QA gate that stops compaction until memory QA and
  two context-free cold boots pass;
- a crash-safe per-persona event consumer;
- direct hosted unread reconciliation with `mark_read=false`;
- a supervised app-server bridge with bounded outbound sending;
- model selection through `model/list`;
- a dedicated persistent hive thread and routing registry;
- private draft/state files and content-free diagnostics;
- a macOS LaunchAgent installer.

## Safety defaults

- Kijito mail bodies are untrusted.
- Ordinary operational words such as URLs, `token`, `secret`, and `install`
  add a caution but do not suppress account-persona mail. Only oversize bodies
  and narrow high-confidence prompt-override phrases are quarantined from model
  context.
- The proactive bridge wakes for every valid persona message produced by the
  account-scoped Kijito inbox stream. Sender identity and priority come only
  from transport metadata; message bodies remain untrusted.
- Drafting turns run with approval policy `never`, a read-only sandbox, an
  allowlisted environment, a dedicated isolated home and config, no
  MCP/apps/hooks/shell/web tools, and no network.
- `thread/inject_items` is disabled on the action path.
- Model-authored drafts require an exact interactive user approval.
- Autonomous sending is limited to exact low-risk protocol messages from an
  allowed sender and uses a deterministic local template, never model output.
- Outbound state is reserved before the network call. Ambiguous delivery is
  never retried automatically, preventing duplicate replies.
- Drafts are written with mode `0600`.

## Commands

```bash
node scripts/bridge.mjs --once --dry-run
node scripts/bridge.mjs --once --reconcile
node scripts/send-draft.mjs --draft ~/.cache/kijito-codex-bridge/drafts/draft-codex-ID.json
node scripts/doctor.mjs
node scripts/install-launch-agent.mjs
node tests/run-tests.mjs
node tests/adversarial-gate.mjs
node tests/cwd-independence-gate.mjs
node tests/live-gate.mjs
KIJITO_POINTER_ID=REPLACE_WITH_POINTER_ID KIJITO_POINTER_DIGEST=REPLACE_WITH_POINTER_DIGEST node tests/live-installed-precompact-gate.mjs
KIJITO_LIVE_PHASE=initial KIJITO_LIVE_RIVER_MESSAGE_ID=ID KIJITO_LIVE_SECOND_MESSAGE_ID=ID KIJITO_LIVE_SECOND_PERSONA=maestro node tests/live-cross-persona-gate.mjs
KIJITO_LIVE_PHASE=fresh KIJITO_LIVE_STATE_DIR=PHASE_ONE_STATE_DIR KIJITO_LIVE_FRESH_MESSAGE_ID=NEW_ID KIJITO_LIVE_FRESH_PERSONA=river node tests/live-cross-persona-gate.mjs
KIJITO_HEALTH_SOURCE_MESSAGE_ID=ID node tests/live-health-ack-gate.mjs
```

For a release gate, run the live scripts from the frozen installed-cache root,
not a mutable source checkout. Cross-persona phase one proves both initial
messages present and then absent on replay, and emits a private state directory.
Only after that phase completes may River or another real non-Codex persona
send the fresh control message. Phase two reuses the exact directory, proves
that fresh ID surfaces once while the old IDs remain absent, and proves the
fresh ID is also suppressed on replay. The health gate waits a bounded interval
for the bridge's first ACK before measuring replay behavior.

To stop the background bridge without deleting its plist:

```bash
node scripts/install-launch-agent.mjs --uninstall
```

The installer preserves the disabled plist with a timestamp.

`send-draft.mjs` requires an interactive TTY, displays the exact recipient,
source message, digest, and body, then requires a draft-bound confirmation
phrase. There is intentionally no `--yes` or non-interactive approval flag.

## Hook activation

Installing the plugin does not automatically trust its hooks. Open a new Codex
thread, run `/hooks`, review the Kijito Hive Member definitions, and trust the
complete current set. Codex hashes each lifecycle definition separately, so
verify that all five—SessionStart, UserPromptSubmit, PreCompact, PostCompact,
and Stop—are enabled and show as trusted. Any later hook edit correctly
requires a new review.

Hook commands run through `scripts/run-node.sh`. It accepts an explicit
absolute `KIJITO_NODE` override, otherwise verifies the first usable Node.js
18+ runtime from `PATH` and common per-user installation locations before
launching the hook. Candidate checks clear `NODE_OPTIONS` and `NODE_PATH` and
load the native HTTP, HTTPS, and crypto modules the hook needs. `PreCompact`
adds a POSIX fail-closed wrapper and an internal 10-second deadline so runtime
failure or a hang still emits `continue: false` before Codex's 15-second hook
timeout.

## Compaction-first context recycle

The native `/status` command and TUI `context-remaining` item are the
authoritative user displays. The hook reads only validated numeric metrics from
the exact current session transcript; it never guesses the newest session or
injects transcript content. If the schema is unknown, it reports `unknown` and
directs the user to `/status`.

Native Codex compaction—not routine `/clear`—is the normal self-clear path.
At 60% measured use, Codex plans a clean handoff. User-prompt and autonomous
`Stop` boundaries both surface the requirement. Before compaction it runs the
packaged `kijito-qa-memory` workflow, refreshes the stable `RESUME NOW` pointer,
and requires two clean context-free cold boots. The resulting private pass is
valid for 30 minutes, bound to the current session, transcript identity,
pointer ID, and SHA-256 of the exact pointer content reviewed by both cold
boots. It permits at most 1 MiB of transcript growth after QA and is consumed
once by `PreCompact`. Without it, compaction stops. The safety-critical launcher
also returns a blocking result on runtime failure, malformed input, empty or
runaway output, and an inner ten-second deadline that expires before Codex's
fifteen-second hook timeout.

The record command emits a machine-readable `kijito.compaction.ready` signal
with a cryptographic per-compaction nonce. The adapter that already owns the
active thread then requests native compaction:
`thread/compact/start` for an app-server host, literal `/compact` for an
explicitly pinned CLI pane. This request cannot authorize itself; `PreCompact`
still validates and atomically promotes the one-use pass into a nonce-bound
re-entry ticket. Never start a replacement app-server connection, call
`thread/resume`, guess a thread or pane, inject arbitrary keystrokes, or
substitute `/clear`. A host without a safe preemptive trigger does not claim
autonomous recycle support; forced automatic compaction is a ceiling, not the
normal path.

After compaction, `PostCompact` alone atomically claims that ticket and emits
one `$kijito-start` instruction after writing a private consumed-nonce receipt.
`SessionStart(compact)` is a no-op, as is a duplicate `PostCompact` after the
nonce is claimed. Persistent autonomous-goal continuation then resumes the
exact pointer action. An interactive session is instead ready for its next
user turn.

If compaction aborts after `PreCompact` promotes the pass but before
`PostCompact`, the orphaned ticket is not reused. It expires after 30 minutes,
and the next attempt requires fresh memory QA. This is intentionally
conservative. Atomic ticket-to-claim rename provides replay exclusion; the
consumed-nonce receipt is audit evidence only.

The hook emits a `pointer-digest.mjs` command that fetches the hosted pointer
and prints only its exact UTF-8 content SHA-256. That value must match both
cold-boot reports. Record the pass last and make no later pointer edit.
`PreCompact` remains pure-filesystem: it validates and reports the attested
digest but does not refetch Kijito, so the guarantee is revision-specific
attestation plus strict workflow ordering, not a live network recheck.
Finish dreaming before the final pointer update. Keep a single-writer pointer
lease across both bracketed cold boots and the final record action. Every boot
must call `kijito_startup` for identity and broad context, then explicitly call
`kijito_recall` with the stable pointer-only query
`CODEX_CURRENT_STATE_POINTER_V1 RESUME NOW`. Require one unambiguous top
current-state result whose ID equals the pointer ID embedded in the helper
command, and prove the pointer digest is unchanged before versus after its
Kijito read. Every boot scans all returned live bodies and fails if a body other
than the selected pointer contains the literal marker. Bare startup ranking is
not a pointer-discovery guarantee. Retired version-history snapshots may retain
the marker but remain below the recall floor and audit-only under the rules
below. No live support memory may repeat the literal marker; it must remain
pointer-only. No other seat may edit the pointer during the
final-check-to-record window; that workflow discipline covers the accepted
attestation-only residual.

The token cryptographically binds only the pointer's exact content. Cold boots
provide best-effort verification of linked and recall-reached graph state at
verification time; they do not cryptographically freeze that unbounded surface
or prevent later graph changes. Production is single-writer-of-own-handoff.
The advisory pointer lease protects the concurrent development harness without
claiming linked-memory, edge, or graph-wide cryptographic coverage.
Kijito may attach retired `version_history` predecessors to a living pointer
when preserving update history. A predecessor marked with that source is audit
history. More importantly, any memory at the predecessor end of a
`version_of`, `derived:version_of`, or `version_history` edge from a newer
memory is audit history regardless of importance; importance is corroboration,
never the discriminator. Neither is a second current-state pointer. Startup
and cold-boot workflows classify links before fetching bodies and never follow
a `RESUME NOW` directive from a retired predecessor. The renderer's unavoidable
bounded edge previews remain opaque metadata and are reported loudly as
superseded without failing the boot. A separate full-body fetch of a retired
predecessor fails the boot. Ambiguous archive metadata fails the boot instead
of guessing.
The digest helper depends on the hosted `GET /api/memory/<id>` renderer
returning the requested Codex-owned content fence as the final response
segment. It removes only the renderer's boundary newlines, preserving content
whitespace, blank lines, trailing spaces, trailing newlines, and Unicode.
Missing, malformed, wrong-owner, mismatched, or non-final fences fail closed;
renderer-format drift therefore restarts the review instead of producing an
ambiguous digest. The helper also refuses multiple owned opening fences or any
nested complete fence marker. Kijito strips literal fence markers on both
write and render, so either condition signals contract drift or a forged
response rather than valid canonical pointer content.

The pass is an agent attestation, not a substitute for reviewing the two
cold-boot reports. Record it only with the exact command emitted by the active
hook; if that command is unavailable, keep compaction blocked rather than
guessing a plugin path.

Never use app-server `thread/resume` as a token-usage probe. Resuming a thread
with an active persistent goal can start autonomous work. Codex 0.145.0 has no
read request for token usage; an app host may cache notifications it already
owns, while this plugin uses the exact-thread validated fallback.

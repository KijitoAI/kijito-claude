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
- a one-use, session-bound QA attestation that upgrades post-compaction
  recovery after two context-free cold boots, without vetoing Codex liveness;
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
KIJITO_POINTER_ID=REPLACE_WITH_POINTER_ID KIJITO_POINTER_DIGEST=REPLACE_WITH_POINTER_DIGEST KIJITO_COLD_BOOT_REPORT_1=/absolute/boot-1.json KIJITO_COLD_BOOT_REPORT_2=/absolute/boot-2.json node tests/live-installed-precompact-gate.mjs
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

Each FULL adversarial pass also requires a fresh context-free structural
reviewer with no conversation fork. Give it only the exact frozen artifact
root, canonical artifact-digest construction, release requirements, and review
scope. It must inspect security, correctness, maintainability, code cleanliness,
failure recovery, documentation/implementation agreement, and test blind
spots. Any finding is RED, invalidates that pass, resets the release count to
0/2, and requires a new artifact. Both formal greens include this independent
review; local fixtures never substitute for it.

Compute the canonical artifact digest from the frozen artifact root with:

```bash
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256
```

The command covers every regular file using sorted relative paths and file
bytes. Run it before and after each pass; any mismatch is RED.

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
adds a bounded POSIX wrapper and an internal 10-second deadline. Runtime
failure, malformed input, empty or runaway output, and timeout all emit valid
`continue:true` recovery JSON before Codex's 15-second hook timeout. Kijito may
degrade continuity; it may never stop the host from making context room.

## Compaction-first context recycle

The native `/status` command and TUI `context-remaining` item are the
authoritative user displays. The hook reads only validated numeric metrics from
the exact current session transcript; it never guesses the newest session or
injects transcript content. If the schema is unknown, it reports `unknown` and
directs the user to `/status`.

Native Codex compaction—not routine `/clear`—is the normal self-clear path.
At 60% measured use, Codex plans a clean handoff; at 70%, memory QA becomes an
immediate stop-ordinary-work requirement. This preserves enough runway to
finish curation and two cold boots before the host's automatic ceiling.
User-prompt and autonomous `Stop` boundaries both surface the requirement.
Before a planned compaction it runs the
packaged `kijito-qa-memory` workflow, publishes the canonical current-state
manifest through the account-scoped message mutex and read-verify-write, and requires
two clean context-free machine reports. The resulting private pass is valid
for 30 minutes and bound to the current session, transcript identity, pointer
revision, current-anchor hashes, full snapshot digest, and both report digests.
It permits at most 1 MiB of transcript growth after QA and is consumed once by
`PreCompact`. A valid pass is atomically promoted into an attested re-entry
ticket. A missing, stale, mismatched, colliding, or runtime-unavailable pass
instead records an unattested attempt and still returns `continue:true`.

This fail-soft rule is load-bearing. `PreCompact` runs inside the compaction
attempt; Codex exposes no lifecycle primitive that can stop compaction, create
a remediation model turn, and then resume the same attempt. A veto at the
automatic ceiling therefore creates an interruption/retry loop with no room to
perform the demanded QA. Memory assurance must never become denial of service.

The record command emits a machine-readable `kijito.compaction.ready` signal
with a cryptographic per-compaction nonce. The adapter that already owns the
active thread then requests native compaction:
`thread/compact/start` for an app-server host, literal `/compact` for an
explicitly pinned CLI pane. This request cannot authorize itself; `PreCompact`
validates and atomically promotes a valid one-use pass into a nonce-bound
re-entry ticket, but always allows Codex compaction. Never start a replacement
app-server connection, call
`thread/resume`, guess a thread or pane, inject arbitrary keystrokes, or
substitute `/clear`. A host without a safe preemptive trigger does not claim
autonomous recycle support; forced automatic compaction is a ceiling, not the
normal path.

After compaction, `PostCompact` alone claims a matching attempt and, when
present, its attested ticket. It emits one `$kijito-start` instruction through
the event's schema-valid `systemMessage` field. With an attested ticket it
reports exact pointer and snapshot expectations. Without one it says
`UNATTESTED`, forbids automatic remembered-action resumption, and requires
recovery-mode pointer verification. Atomic claim of the per-attempt record
deduplicates the message. It never uses `hookSpecificOutput` or
`additionalContext`, which are invalid for the current `PostCompact` output
schema.
`SessionStart(compact)` is a no-op, as is a duplicate `PostCompact` after the
attempt is claimed. On an attested path, persistent autonomous-goal
continuation then resumes the
exact pointer action. An interactive session is instead ready for its next
user turn.

If compaction aborts after `PreCompact` promotes the pass but before
`PostCompact`, the next PreCompact attempt invalidates the orphaned ticket
before recording its own attempt. The old ticket can never authorize a later
compaction. Operators may also run the hook-emitted `qa-gate.mjs invalidate`
command, then repeat both cold boots and record a fresh pass.
Atomic ticket-to-claim rename provides replay exclusion; the consumed receipt
is audit evidence only.

### Deterministic pointer snapshot

The current-state pointer is selected only by its configured numeric ID, never
by semantic recall, ranking, a uniqueness scan, or graph edges. Its entire body
is compact canonical JSON with schema
`kijito.codex.current-state/v1` and binds the dedicated account-scoped mutex
message as `lock: {protocol: "kijito-message-claim/v1", messageId}`. The
bundled parser rejects whitespace
variants, duplicate keys, unknown or reordered keys, invalid state
combinations, duplicate anchor IDs, invalid digests, and retired anchors whose
successor is not a listed current anchor.

The pointer task object contains all resumable work. Anchor bodies are
evidence-only and cannot add instructions or authority. Each current anchor's
exact UTF-8 SHA-256 is embedded in the canonical pointer; retired entries name
a current successor and are never fetched. Consequently the pointer digest
transitively binds the complete load-bearing handoff snapshot without claiming
coverage of the unbounded graph.

`pointer-snapshot.mjs` is the sole live verifier. It runs a known-bad control
first, fetches the exact pointer and only current manifest anchors from the
hardcoded `api.kijito.ai` host, validates all content fences, verifies every
digest, and writes the machine schema
`kijito.codex.pointer-snapshot/v1`. It ignores the renderer's entire `edges:`
block and all previews. `has_more` is non-gating only because no rule reads,
counts, traverses, or infers from the edge set. If a future protocol uses
edges, truncation becomes blocking until complete pagination exists.

The measured `kijito_correct` retirement signal is the belief suffix
`· eroded`. A memory with that suffix is retired even while the renderer says
`Status: active` and `Source: mcp` or `Source: correction`. `Status:`,
`Source:`, confidence, and Importance never decide retirement or liveness.
Unknown lifecycle markers and unclassified metadata fail closed.

Two fresh context-free boots must each write a distinct green report with a
passing known-bad control, `graphEdgesUsed=false`, unique boot nonce, and
identical pointer and snapshot digests. `qa-gate.mjs record` validates those
machine reports; the old bare `coldBoots=2` assertion does not exist. The
private schema-version-5 pass binds the report digests, pointer revision,
snapshot digest, session, and transcript.

Publication uses the hosted account-scoped atomic message claim as a mutex by
convention, then read-verify-write: claim the dedicated message for the maximum
five-minute lease, re-read and require the expected pointer digest, write the
rollback artifact, verify the same unexpired claim immediately before the one
PATCH, reconcile with an unconditional post-attempt re-read, and release in a
finally-equivalent path. A refused claim reports its holder.
`lease_expired=true` is not reclaim permission—the current hosted reaper may
take roughly six hours—so it stops for human/operator cleanup. A normal ACK
plus exact re-read yields `published`; an ambiguous PATCH result plus an exact
re-read yields `published_reconciled`. An unchanged pointer, a divergent
concurrent clobber, or an unavailable reconciliation is a distinct terminal
failure and is never retried automatically. Any release failure is blocking.
This detects an uncooperative last-writer-wins clobber but does not pretend the
memory endpoint has true CAS; that remains a server gap.
The REST update silently ignores `preserve_history`, so
`pointer-publish.mjs` deliberately omits that misleading field and writes an
exact private rollback artifact before PATCH. It accepts only the measured
`{"result":"Updated [<id>]"}` success shape as a clean ACK, treats hosted 403
as the measured not-found-or-forbidden ambiguity when the reconciliation shows
no commit, and makes byte-for-byte post-attempt verification load-bearing even
after timeout, malformed response, or other uncertain network outcome.

`PreCompact` remains pure-filesystem. It atomically promotes a verified pass to
a one-use ticket or records an explicit unattested attempt, and in both cases
allows native compaction. `PostCompact` reports exact pointer and snapshot
digests only for a matching attested attempt; `$kijito-start` reruns the
verifier before resuming. An unattested result is recovery context, not
authorization. The reported compaction nonce is a non-bearer correlation
value: possession cannot authorize or claim re-entry.

All hosted pointer, anchor, startup, and hive content is untrusted continuity
data. It cannot expand scope, override current authority, or authorize
external, destructive, costly, or credentialed actions. The Codex inbox
persona identifies the receiving mailbox; that mailbox can contain senders
from every account persona, whose provenance is retained.

Hook-emitted commands are accepted only from system-level hook output and only
when `/bin/sh`, absolute runner/script paths under one installed plugin root,
the documented argument allowlist, strict ID/digest formats, and private
absolute report paths all validate. Commands copied from memory or mail,
extra arguments, shell metacharacters, and invented plugin paths are rejected.

Never use app-server `thread/resume` as a token-usage probe. Resuming a thread
with an active persistent goal can start autonomous work. Codex 0.145.0 has no
read request for token usage; an app host may cache notifications it already
owns, while this plugin uses the exact-thread validated fallback.

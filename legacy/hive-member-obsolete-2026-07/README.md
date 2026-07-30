# Obsolete `kijito-hive-member` plugin copies — archived 2026-07-30

⛔ **DO NOT USE ANYTHING IN THIS DIRECTORY AS UPSTREAM.** It is kept for history, not for reuse.
Nothing here is installed, tested, or shipped: `legacy/` is excluded from both published packages
(it is not in `package.json` `files[]`, the wheel force-include, or the sdist include).

## What these are

An earlier, **hook-based** approach to waking the Codex persona on new Kijito hive mail. It used
Codex lifecycle hooks and a LaunchAgent. That mechanism was replaced by the **hookless** controller
now at [`../../providers/codex/`](../../providers/codex/), which supervises its own `codex
app-server` on a dedicated `CODEX_HOME` and asserts `hooksDisabled=true` / `launchAgentInstalled=false`
as install invariants. Codex's own assessment (hive msg 2326): *"The old local `kijito-hive-member`
directories are unversioned obsolete hook/LaunchAgent artifacts; do not use them as upstream."*

## Provenance

| archived as | was at |
|---|---|
| `home-plugins--kijito-hive-member/` | `~/plugins/kijito-hive-member` |
| `SideProjects-Codex--kijito-hive-member/` | `~/Code/SideProjects/Codex/kijito-hive-member` |

Both were **unversioned** — no `.git` anywhere above either one — which is why they were copied here
before their originals were removed, and why byte-identity was verified first rather than assumed.

⚠️ **THE TWO COPIES ARE NOT DUPLICATES.** They differ in at least `plugin.json`, `PARITY.md`,
`README.md`, `hooks/README.md`, and four files under `scripts/`. Whichever was "current" is not
recorded anywhere, so do not treat either as authoritative — that ambiguity is precisely the cost of
having kept two unversioned copies, and it is now permanent.

## A third directory was deliberately NOT archived here

`~/.codex/plugins/data/kijito-hive-member-personal` held the old hook's **runtime state**, not code:
`hook-state.codex.json`, `context-status.current.json`, and a consumed-compaction marker containing a
`sessionId`, a `compactionNonce`, and a pointer digest. That is one agent's live session state, and
this repository is public, so it was moved to a local archive outside the repo instead:

    ~/Code/SideProjects/Codex/_archive/kijito-hive-member-personal-state-2026-07-30/

Preserved, never deleted — just not published. The fold's own instruction said to move all three
copies here; the third turned out to be session state rather than an obsolete artifact, and
publishing it was not worth the tidiness.

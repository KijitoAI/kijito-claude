# N0 disposable evidence harness

Status: **TEST-ONLY, NON-INSTALLABLE, NO LIVE PROBE AUTHORITY.**

This directory implements only step 2 of
[`../n0-capability-probe-protocol.md`](../n0-capability-probe-protocol.md): bounded rollout snapshots,
strict parsers, synthetic fixtures, and the `N0_TEST_ORACLE`. It cannot create or manage a Scheduled
task, drive the ChatGPT UI, start or stop a controller, contact Kijito, send mail, mark mail read,
generate a live marker, or report production `ARMED`.

The modules are deliberately separated:

- `snapshot.mjs` walks one caller-supplied app-owned root without symlinks, newest/mtime selection,
  or path escape and records stable file identity before comparing growth;
- `parser.mjs` requires `session_meta.payload.id`, attributes marker and run nonces only inside one
  user-turn span, binds exact task/run/turn/environment evidence, rejects structural steering, parses
  only the final exact-ID/persona Kijito main block, and verifies the exact non-mutating test-mail
  fetch artifact;
- `oracle.mjs` validates the frozen specimen, write-boundary canaries, lifecycle evidence, live-brain
  challenges, exact prompt bytes, project/rollout/parser provenance, journal/signer negatives, and
  every per-case nonce/run/receipt binding. Its sole positive value is `N0_TEST_CAPABLE`;
- `fixture.mjs` contains deterministic synthetic data only. Its fixed hexadecimal strings are not
  live nonces and must never be copied into a real probe;
- `prompt.mjs` renders exact per-case prompt bytes, including the fixed hostile-data negative fixture,
  and `specimen.mjs` computes every prompt digest plus inert Kijito request packets without sending;
- `evidence-manifest.mjs` reads stable owner-matching files beneath one explicit control root and
  produces or validates a relative-path/size/SHA-256 evidence manifest without writing it;
- `cli.mjs` is a read-only convenience wrapper. It accepts evidence files only beneath an explicit
  root, rejects symlinks and concurrent mutation, and has no mutation or network subcommand.

Run the adversarial suite with a healthy Node 18+ runtime:

```sh
node --test providers/codex/test/n0-harness.test.mjs
```

The fail-open completeness gate uses an Acorn AST census, exact-source ownership, and one named
counterexample per executable rejection atom or rejecting-helper call site. Install the pinned
development dependency and run all three layers:

```sh
npm ci
npm run test:n0-census-self
npm run test:n0-census
node providers/codex/test/n0-guard-mutation-runner.mjs
```

The mutation runner copies the harness to an isolated temporary tree, recomputes its aggregate,
asserts the 27/27 baseline before and after, and requires every pristine counterexample to reject
with its exact code while only its isolated fail-open mutant accepts. It also verifies that the
origin HEAD, index, and worktree remain unchanged. Partial census runs are authoring diagnostics,
never an acceptance gate.

The suite includes every mutation floor in protocol section 7, isolated counterexamples for every
oracle guard binding, and Assay round-5 hostile fence and run-nonce user-span controls. Passing this
local suite is author evidence only. The exact unchanged harness commit and manifest digest still
require two consecutive zero-finding Assay reviews before any attended marker or Scheduled action.

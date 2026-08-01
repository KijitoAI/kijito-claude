#!/usr/bin/env node
import path from "node:path";
import { evaluateOracle } from "./oracle.mjs";
import { parseJsonBuffer, readOwnedRegularFile } from "./lib.mjs";
import { snapshotTree } from "./snapshot.mjs";

function usage() {
  process.stderr.write("N0_TEST_ORACLE — non-installable, read-only\nusage: cli.mjs snapshot --root DIR | oracle --root DIR --specimen FILE --evidence FILE [--now-ms N]\n");
  process.exitCode = 64;
}

function args(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) usage();
    options[key.slice(2)] = value;
  }
  return { command, options };
}

try {
  const { command, options } = args(process.argv.slice(2));
  if (!path.isAbsolute(options.root ?? "")) usage();
  if (command === "snapshot") {
    process.stdout.write(`${JSON.stringify(snapshotTree(options.root))}\n`);
  } else if (command === "oracle") { if (!options.specimen || !options.evidence) usage(); options.specimen ??= path.join(options.root, "specimen.json"); options.evidence ??= path.join(options.root, "evidence.json");
    const specimen = parseJsonBuffer(readOwnedRegularFile(options.root, options.specimen).data);
    const evidence = parseJsonBuffer(readOwnedRegularFile(options.root, options.evidence).data);
    const nowMs = options["now-ms"] === undefined ? Date.now() : Number(options["now-ms"]);
    const result = evaluateOracle(specimen, evidence, nowMs);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "N0_TEST_CAPABLE") process.exitCode = 1;
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`${error?.code ?? "N0_CLI_ERROR"}: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
}

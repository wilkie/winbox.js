#!/usr/bin/env node
/**
 * The TypeScript replay's `conformance.json` set beside the Rust replay's,
 * fixture by fixture and function by function: the proof, before the
 * TypeScript replay is deleted, that the Rust replay holds at least what it
 * held (`kb/guides/retire-typescript.md`, "How the Rust engine takes over
 * the replay"). For each function of each fixture in the TypeScript file,
 * the Rust file's `agreed` must be at least the TypeScript file's, or the
 * function must be one of the fixture's named gaps in the Rust file.
 *
 *   node scripts/compare-conformance.mjs TYPESCRIPT.json RUST.json
 *
 * `TYPESCRIPT.json` defaults to `kb/data/conformance.json` as develop's
 * `git show` gives it, and `RUST.json` to the file on disk, which
 * `cargo test --release -p winbox-win16 --test conformance` writes. It
 * prints the counts and every function below, and exits 1 where any is.
 * Deleted with the TypeScript replay (phase 4).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [typescriptFile, rustFile = 'kb/data/conformance.json'] = process.argv.slice(2);
const typescript = JSON.parse(
  typescriptFile
    ? readFileSync(typescriptFile, 'utf8')
    : execFileSync('git', ['show', 'develop:kb/data/conformance.json'], { encoding: 'utf8' })
);
const rust = JSON.parse(readFileSync(rustFile, 'utf8'));

const sum = (report, outcome) =>
  Object.values(report)
    .flatMap((fixture) => Object.values(fixture.functions))
    .reduce((total, counts) => total + counts[outcome], 0);

const below = [];
const excused = [];
const missing = [];
let functions = 0;
let ahead = 0;

for (const [fixture, theirs] of Object.entries(typescript)) {
  const ours = rust[fixture];

  if (!ours) {
    missing.push(fixture);
    continue;
  }

  for (const [name, counts] of Object.entries(theirs.functions)) {
    const agreed = ours.functions[name]?.agreed ?? 0;

    functions++;

    if (agreed > counts.agreed) {
      ahead++;
    }

    if (agreed >= counts.agreed) {
      continue;
    }

    const line = `${fixture}:${name} ${agreed} < ${counts.agreed}`;

    if (name in ours.gaps) {
      excused.push(`${line} (gap: ${ours.gaps[name]})`);
    } else {
      below.push(line);
    }
  }
}

const added = Object.keys(rust).filter((fixture) => !(fixture in typescript));

console.log(
  `fixtures: TypeScript ${Object.keys(typescript).length}, Rust ${Object.keys(rust).length}`
);
console.log(`records agreed: TypeScript ${sum(typescript, 'agreed')}, Rust ${sum(rust, 'agreed')}`);

for (const outcome of ['disagreed', 'unimplemented', 'unsupported']) {
  console.log(
    `records ${outcome}: TypeScript ${sum(typescript, outcome)}, Rust ${sum(rust, outcome)}`
  );
}

console.log(
  `functions: ${functions}, Rust ahead on ${ahead}, below and a named gap ${excused.length}, below and no gap ${below.length}`
);
console.log(
  `known gaps: TypeScript ${Object.values(typescript).reduce((n, f) => n + Object.keys(f.gaps).length, 0)}, Rust ${Object.values(rust).reduce((n, f) => n + Object.keys(f.gaps).length, 0)}`
);

for (const line of excused) {
  console.log(`  excused ${line}`);
}

for (const fixture of missing) {
  console.log(`  MISSING from the Rust report: ${fixture}`);
}

for (const fixture of added) {
  console.log(`  only in the Rust report: ${fixture}`);
}

for (const line of below) {
  console.log(`  BELOW ${line}`);
}

process.exit(below.length || missing.length ? 1 : 0);

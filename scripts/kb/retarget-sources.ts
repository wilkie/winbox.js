/**
 * Points each page's `source:` at the Rust engine: the file of the function
 * its export's arm names (`rustdoc.ts`), where it named a file of the
 * TypeScript engine under `src/win16`. An export that is no function has no
 * arm: one of KERNEL's constants is answered by `linker.rs`
 * (`kernel_constant`), and a place in a module's data by `exported_data.rs`,
 * as `call::answered` tells them apart and `kb/data/winbox-exports.json`
 * marks them. A page whose export is none of these keeps its line and is
 * listed, not guessed at.
 *
 * Run once as the TypeScript engine was retired (2026-11-08):
 *
 *   npx vite build --config scripts/kb/vite.config.ts --ssr scripts/kb/retarget-sources.ts \
 *     && node dist/kb-build/retarget-sources.js
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { collectExports } from './exports.js';
import { parsePage } from './frontmatter.js';
import { scanRust } from './rustdoc.js';

const ROOT = process.cwd();
const arms = new Map([...scanRust(ROOT)].map(([key, arm]) => [key.toUpperCase(), arm]));
/* Where `call::answered` finds what is not a function. */
const BY_KIND: Record<string, string> = {
  constant: 'crates/winbox-win16/src/linker.rs',
  data: 'crates/winbox-win16/src/exported_data.rs',
};
const kinds = new Map(
  collectExports(ROOT).flatMap((module) =>
    module.exports.map((entry) => [`${module.name}.${entry.name}`.toUpperCase(), entry.kind])
  )
);
const byKind: string[] = [];
const unfound: string[] = [];
let retargeted = 0;

const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name.endsWith('.md')
        ? [join(dir, entry.name)]
        : []
  );

for (const file of walk('kb')) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const line = text.match(/^source: (src\/win16\/\S+)$/m);

  if (!line || !text.startsWith('---')) {
    continue;
  }

  const { front } = parsePage(file, text);
  const arm =
    front.kind === 'function' ? arms.get(`${front.module}.${front.name}`.toUpperCase()) : undefined;

  const key = `${front.module}.${front.name}`.toUpperCase();
  const kind = kinds.get(key);

  if (!arm && kind && BY_KIND[kind]) {
    writeFileSync(join(ROOT, file), text.replace(line[0], `source: ${BY_KIND[kind]}`));
    byKind.push(`${file}: ${front.module}.${front.name}, ${kind}`);
    continue;
  }

  if (!arm?.file) {
    unfound.push(`${file}: ${front.module}.${front.name} (${line[1]})`);
    continue;
  }

  writeFileSync(join(ROOT, file), text.replace(line[0], `source: ${arm.file}`));
  retargeted++;
}

console.log(
  `retargeted ${retargeted} by their arms, ${byKind.length} by their kind; not found in Rust ${unfound.length}`
);

for (const line of byKind) {
  console.log(`  by kind: ${line}`);
}

for (const line of unfound) {
  console.log(`  ${line}`);
}

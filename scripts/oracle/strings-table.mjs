#!/usr/bin/env node
/**
 * Writes a module's string table, from the installation the recordings are
 * made on, as a TypeScript map of winbox.js's own: no Windows file is
 * shipped, so a module winbox.js keeps carries its strings itself.
 *
 *   node scripts/oracle/strings-table.mjs <file> <constant> <what> <out.ts>
 *
 * `<file>` is under the installation's `WINDOWS\SYSTEM`; `<what>` completes
 * the sentence "<module>'s strings, by their resource numbers: <what>".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [file, constant, what, out] = process.argv.slice(2);

if (!file || !constant || !what || !out) {
  console.error('usage: strings-table.mjs <file> <constant> <what> <out.ts>');
  process.exit(1);
}

const bytes = readFileSync(join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM', file));
const ne = bytes.readUInt32LE(0x3c);
const table = ne + bytes.readUInt16LE(ne + 0x24);
const shift = bytes.readUInt16LE(table);
const strings = [];

for (let at = table + 2; bytes.readUInt16LE(at);) {
  const type = bytes.readUInt16LE(at);
  const count = bytes.readUInt16LE(at + 2);

  at += 8;

  for (let index = 0; index < count; index++, at += 12) {
    if (type !== 0x8006) {
      continue;
    }

    const block = bytes.readUInt16LE(at + 6) & 0x7fff;
    let offset = bytes.readUInt16LE(at) << shift;

    for (let slot = 0; slot < 16; slot++) {
      const length = bytes[offset];

      if (length) {
        strings.push([
          (block - 1) * 16 + slot,
          bytes.subarray(offset + 1, offset + 1 + length).toString('latin1'),
        ]);
      }

      offset += 1 + length;
    }
  }
}

strings.sort((a, b) => a[0] - b[0]);

const module = file.replace(/\..*$/, '').toUpperCase();
const literal = (text) =>
  `'${JSON.stringify(text).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;

/** A sentence as a comment's lines, none past 80 columns. */
const wrap = (text) => {
  const lines = [];
  let line = '';

  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > 76) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }

  return [...lines, line].map((each) => ` * ${each}`).join('\n');
};

const comment = wrap(
  `${module}'s strings, by their resource numbers: ${what}. winbox.js keeps them itself, as it ` +
    `keeps ${module}: no Windows file is shipped. Made to match the Windows 3.1 the recordings ` +
    'are made on by `scripts/oracle/strings-table.mjs`.'
);

writeFileSync(
  join(ROOT, out),
  `'use strict';

/**
${comment}
 */
export const ${constant}: ReadonlyMap<number, string> = new Map([
${strings.map(([id, text]) => `  [0x${id.toString(16).padStart(3, '0')}, ${literal(text)}],`).join('\n')}
]);
`
);

console.log(`${strings.length} strings -> ${out}`);

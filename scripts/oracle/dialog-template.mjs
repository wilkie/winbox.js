#!/usr/bin/env node
/**
 * Writes one of a module's dialog templates, from the installation the
 * recordings are made on, as TypeScript bytes of winbox.js's own: no Windows
 * file is shipped, so a module winbox.js keeps carries its dialogs itself.
 *
 *   node scripts/oracle/dialog-template.mjs <file> <id> <constant> <what> <out.ts>
 *
 * `<file>` is under the installation's `WINDOWS\SYSTEM`; `<what>` completes
 * the sentence "<module>'s dialog <id>: <what>".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [file, id, constant, what, out] = process.argv.slice(2);

if (!file || !id || !constant || !what || !out) {
  console.error('usage: dialog-template.mjs <file> <id> <constant> <what> <out.ts>');
  process.exit(1);
}

const RT_DIALOG = 0x8005;
const bytes = readFileSync(join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM', file));
const ne = bytes.readUInt32LE(0x3c);
const table = ne + bytes.readUInt16LE(ne + 0x24);
const shift = bytes.readUInt16LE(table);
let template = null;

for (let at = table + 2; bytes.readUInt16LE(at) && !template;) {
  const type = bytes.readUInt16LE(at);
  const count = bytes.readUInt16LE(at + 2);

  at += 8;

  for (let index = 0; index < count; index++, at += 12) {
    if (type === RT_DIALOG && bytes.readUInt16LE(at + 6) === (0x8000 | Number(id))) {
      const offset = bytes.readUInt16LE(at) << shift;

      template = bytes.subarray(offset, offset + (bytes.readUInt16LE(at + 2) << shift));
    }
  }
}

if (!template) {
  console.error(`${file} has no dialog ${id}`);
  process.exit(1);
}

const module = file.replace(/\..*$/, '').toUpperCase();

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
  `${module}'s dialog ${id}: ${what}. winbox.js keeps it itself, as it keeps ${module}: no ` +
    'Windows file is shipped. Made to match the Windows 3.1 the recordings are made on by ' +
    '`scripts/oracle/dialog-template.mjs`.'
);

/* Its bytes as hexadecimal, 32 to a line. */
const hex = template.toString('hex');
const rows = [];

for (let at = 0; at < hex.length; at += 64) {
  rows.push(`    '${hex.slice(at, at + 64)}'`);
}

writeFileSync(
  join(ROOT, out),
  `'use strict';

/**
${comment}
 */
export const ${constant} = Uint8Array.from(
  (
${rows.join(' +\n')}
  )
    .match(/../g)!
    .map((pair) => parseInt(pair, 16))
);
`
);

console.log(`${template.length} bytes -> ${out}`);

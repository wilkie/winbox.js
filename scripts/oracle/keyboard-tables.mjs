#!/usr/bin/env node
/**
 * Writes the US keyboard driver's tables, from the installation the
 * recordings are made on, as winbox.js's own: no Windows file is shipped, so
 * the keyboard module winbox.js keeps carries them itself.
 *
 *   node scripts/oracle/keyboard-tables.mjs
 *
 * Out: `src/win16/keyboard/tables.ts` -- the ANSI and OEM translations
 * (`KEYBOARD.DRV` seg10 `06fe`, `079e`) and the layout `VkKeyScan` reads (the
 * tables in seg2, their header in seg3 `0000`, the shifts in seg5 `0000`).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bytes = readFileSync(
  join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM', 'KEYBOARD.DRV')
);
const ne = bytes.readUInt32LE(0x3c);
const segmentTable = ne + bytes.readUInt16LE(ne + 0x22);
const shift = bytes.readUInt16LE(ne + 0x32);

/** Segment N, counted from 1, as the file holds it. */
function segment(number) {
  const entry = segmentTable + (number - 1) * 8;
  const at = bytes.readUInt16LE(entry) << shift;

  return bytes.subarray(at, at + (bytes.readUInt16LE(entry + 2) || 0x10000));
}

const hex = (data) => {
  const words = [...data].map((byte) => `0x${byte.toString(16).padStart(2, '0')}`);
  const lines = [];

  for (let at = 0; at < words.length; at += 12) {
    lines.push(`  ${words.slice(at, at + 12).join(', ')},`);
  }

  return `[\n${lines.join('\n')}\n]`;
};

const translations = segment(10);
const tables = segment(2);
const header = segment(3);
const shifts = segment(5);
const word = (at) => header[at] | (header[at + 1] << 8);

const layout = [0, 1, 2, 3].map((n) => {
  const count = word(0x02 + n * 2);
  const keys = word(0x12 + n * 2);
  const characters = word(0x22 + n * 2);

  return {
    keys: tables.subarray(keys, keys + count),
    characters: tables.subarray(characters, characters + (n === 0 ? count * 2 : count)),
    shift: shifts[n * 2],
  };
});

writeFileSync(
  join(ROOT, 'src', 'win16', 'keyboard', 'tables.ts'),
  `'use strict';

/**
 * The US keyboard's tables, winbox.js's own as the keyboard module is: no
 * Windows file is shipped. Made to match the Windows 3.1 the recordings are
 * made on by \`scripts/oracle/keyboard-tables.mjs\`.
 */

/** ANSI to OEM: 01h to 1Fh, then 80h to FFh. See \`oem.ts\`. */
export const ANSI_TO_OEM = Uint8Array.from(${hex(translations.subarray(0x6fe, 0x6fe + 160))});

/** OEM to ANSI: 01h to 1Fh, then 80h to FFh. */
export const OEM_TO_ANSI = Uint8Array.from(${hex(translations.subarray(0x79e, 0x79e + 160))});

/**
 * The layout \`VkKeyScan\` reads, as four tables: each key's virtual key, the
 * characters it types -- table 0 unshifted and shifted, in pairs -- and the
 * table's shift state. See \`scan.ts\`.
 */
export const LAYOUT: { keys: Uint8Array; characters: Uint8Array; shift: number }[] = [
${layout
  .map(
    (table) =>
      `  {\n    keys: Uint8Array.from(${hex(table.keys)}),\n    characters: Uint8Array.from(${hex(table.characters)}),\n    shift: ${table.shift},\n  },`
  )
  .join('\n')}
];
`
);

console.log('src/win16/keyboard/tables.ts');

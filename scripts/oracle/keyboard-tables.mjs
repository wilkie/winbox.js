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
 * tables in seg2, their header in seg3 `0000`, the shifts in seg5 `0000`);
 * and, in it and in `crates/winbox-win16/src/keyboard_tables.rs` for the
 * Rust engine, what the rest of the driver reads: the keys' names
 * `GetKeyNameText` answers (seg9), the segment of tables `GetTableSeg`
 * answers (seg2 `0000`-`0087`), and the driver's data that `Inquire`,
 * `GetKeyboardType` and `ToAscii` read (seg11).
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

/* The driver's data as it has it once started: seg11, with what NewTable
 * copies over it from seg3 (seg3 `0194`). */
const data = Buffer.from(segment(11));

segment(3).copy(data, 0x14, 0x00, 0x30);
segment(3).copy(data, 0x54, 0x30, 0x5a);

const dataWord = (at) => data[at] | (data[at + 1] << 8);
const scanTable = dataWord(0x44);
const scanLimit = dataWord(0x46);
const numpad = dataWord(0xf7);

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
 * Each scan code's virtual key, from 0 to \`SCAN_LIMIT\` and the byte after,
 * which \`MapVirtualKey\` reads (\`KEYBOARD.DRV\` seg11 \`0048\`).
 */
export const SCAN_TO_VK = Uint8Array.from(${hex(data.subarray(scanTable, scanTable + scanLimit + 1))});

/** The last scan code \`SCAN_TO_VK\` answers for. */
export const SCAN_LIMIT = ${scanLimit};

/** The numeric keypad's virtual keys, for scan codes 47h to 53h (seg11 \`00ea\`). */
export const NUMPAD_VK = Uint8Array.from(${hex(data.subarray(numpad, numpad + 13))});

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

/* The keys' names (seg9): the strings each index names (`01c7`), the scan
 * codes with a name and each one's index -- plain (`0261`, 2Fh of them),
 * extended (`02bf`, 15h) -- the indices taken for another where the
 * "don't care" bit is set (`02e9`, 4), and the dead keys' characters with
 * theirs (`02f1`, 10). */
const names = segment(9);
const nameWord = (at) => names[at] | (names[at + 1] << 8);
const cString = (at) => {
  let end = at;

  while (names[end]) {
    end++;
  }

  return names.toString('latin1', at, end);
};
const NAME_TABLE = 0x1c7;
const NAME_COUNT = (0x261 - NAME_TABLE) / 2;
const keyNames = Array.from({ length: NAME_COUNT }, (_, i) =>
  cString(nameWord(NAME_TABLE + i * 2))
);
const nameTables = {
  PLAIN_NAME_SCANS: names.subarray(0x261, 0x261 + 0x2f),
  PLAIN_NAME_INDEX: names.subarray(0x290, 0x290 + 0x2f),
  EXTENDED_NAME_SCANS: names.subarray(0x2bf, 0x2bf + 0x15),
  EXTENDED_NAME_INDEX: names.subarray(0x2d4, 0x2d4 + 0x15),
  DONT_CARE_FROM: names.subarray(0x2e9, 0x2e9 + 4),
  DONT_CARE_TO: names.subarray(0x2ed, 0x2ed + 4),
  DEAD_NAME_CHARACTERS: names.subarray(0x2f1, 0x2f1 + 10),
  DEAD_NAME_INDEX: names.subarray(0x2fb, 0x2fb + 10),
};

/* What `GetTableSeg` answers a selector of: seg2 up to its code. */
const tableSegment = tables.subarray(0, 0x88);

/* The driver's data, as it starts: `Inquire`'s six bytes (`0131`), the
 * function keys of each keyboard type from 1 (`00e4`), each shift state's
 * table, doubled, FFh for none (`0112`), and the numeric keypad's digits
 * for scan codes 47h to 52h, FFh for none (`011a`). */
const inquire = data.subarray(0x131, 0x137);
const functionKeys = data.subarray(0xe4, 0xe4 + 6);
const shiftTables = data.subarray(0x112, 0x112 + 8);
const padDigits = data.subarray(0x11a, 0x11a + 12);

const tsArray = (name, bytes, comment) =>
  `/** ${comment} */\nexport const ${name} = Uint8Array.from(${hex(bytes)});\n`;

writeFileSync(
  join(ROOT, 'src', 'win16', 'keyboard', 'tables.ts'),
  readFileSync(join(ROOT, 'src', 'win16', 'keyboard', 'tables.ts'), 'latin1') +
    `
/** The keys' names \`GetKeyNameText\` answers, by index (seg9 \`01c7\`). */
export const KEY_NAMES: string[] = ${JSON.stringify(keyNames)};

${Object.entries(nameTables)
  .map(([name, bytes]) => tsArray(name, bytes, `\`GetKeyNameText\`'s \`${name}\` (seg9).`))
  .join('\n')}
${tsArray('TABLE_SEGMENT', tableSegment, "What `GetTableSeg`'s segment holds: seg2 `0000`-`0087`.")}
${tsArray('INQUIRE', inquire, "`Inquire`'s six bytes (seg11 `0131`).")}
${tsArray('FUNCTION_KEYS', functionKeys, 'Function keys of each keyboard type from 1 (seg11 `00e4`).')}
${tsArray('SHIFT_TABLES', shiftTables, "Each shift state's table, doubled, FFh for none (seg11 `0112`).")}
${tsArray('PAD_DIGITS', padDigits, 'The keypad digits for scan codes 47h-52h, FFh for none (seg11 `011a`).')}`
);

const rsArray = (name, bytes, comment) => {
  const words = [...bytes].map((byte) => `0x${byte.toString(16).padStart(2, '0')}`);

  return `/// ${comment}\npub const ${name}: [u8; ${bytes.length}] = [${words.join(', ')}];\n`;
};

writeFileSync(
  join(ROOT, 'crates', 'winbox-win16', 'src', 'keyboard_tables.rs'),
  `//! What the US keyboard driver reads besides its layout, WinBox's own as
//! the keyboard module is: made to match the Windows 3.1 the recordings
//! are made on by \`scripts/oracle/keyboard-tables.mjs\`, with
//! \`src/win16/keyboard/tables.ts\` its TypeScript twin. Do not edit by
//! hand.

/// The keys' names \`GetKeyNameText\` answers, by index (seg9 \`01c7\`).
pub const KEY_NAMES: [&str; ${keyNames.length}] = [${keyNames.map((name) => JSON.stringify(name)).join(', ')}];

${Object.entries(nameTables)
  .map(([name, bytes]) => rsArray(name, bytes, `\`GetKeyNameText\`'s \`${name}\` (seg9).`))
  .join('\n')}
${rsArray('TABLE_SEGMENT', tableSegment, "What `GetTableSeg`'s segment holds: seg2 `0000`-`0087`.")}
${rsArray('INQUIRE', inquire, "`Inquire`'s six bytes (seg11 `0131`).")}
${rsArray('FUNCTION_KEYS', functionKeys, 'Function keys of each keyboard type from 1 (seg11 `00e4`).')}
${rsArray('SHIFT_TABLES', shiftTables, "Each shift state's table, doubled, `FFh` for none (seg11 `0112`).")}
${rsArray('PAD_DIGITS', padDigits, 'The keypad digits for scan codes 47h-52h, `FFh` for none (seg11 `011a`).')}`
);

console.log('crates/winbox-win16/src/keyboard_tables.rs');

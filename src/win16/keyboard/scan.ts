'use strict';

import { driverSegments } from './driver-file.js';

/**
 * `VkKeyScan`: the virtual key a character is typed with, and the shift
 * state it takes.
 *
 * **Read out of `KEYBOARD.DRV`** (seg5 `0007`) and **recorded** by `misc`,
 * every character from 0 to 255:
 *
 * * FFh answers `ffff`. A capital letter is its own key with Shift, 01h in the
 *   high byte; a small letter is the capital's key alone.
 * * Anything else is looked for in the layout's character tables, up to four
 *   and in order, and the first match answers. Table 0 holds each key's
 *   character unshifted and shifted, in pairs; the others one character a
 *   key. The high byte is the table's shift state, read from seg5 `0000`
 *   (0, 2, 6 and 7), plus 1 for a shifted character of table 0: 1 is Shift,
 *   2 Ctrl, 4 Alt.
 * * A character no table has: 01h to 1Ah is Ctrl and its letter, and the rest
 *   answer `ffff`.
 *
 * The tables are the driver's own, which it keeps in seg2 when
 * `SYSTEM.INI`'s `keyboard.dll=` names no layout, as the installation's does
 * not: their counts and places are the header in seg3 `0000` that the driver
 * copies into its data as it starts (seg3 `0194`). A layout library is not
 * followed.
 */

const TABLES_SEGMENT = 2;
const HEADER_SEGMENT = 3;
const SHIFT_SEGMENT = 5;

/** Offsets in the seg3 header of each table's count, keys and characters. */
const COUNTS = 0x02;
const KEYS = 0x12;
const CHARACTERS = 0x22;

interface Layout {
  tables: { keys: Uint8Array; characters: Uint8Array; shift: number }[];
}

/** Reads the layout's tables out of the driver, once. */
async function layout(system: any): Promise<Layout | null> {
  if (system._keyboardLayout !== undefined) {
    return system._keyboardLayout;
  }

  system._keyboardLayout = null;

  const segments = await driverSegments(system, [TABLES_SEGMENT, HEADER_SEGMENT, SHIFT_SEGMENT]);
  const tables = segments?.get(TABLES_SEGMENT);
  const header = segments?.get(HEADER_SEGMENT);
  const shifts = segments?.get(SHIFT_SEGMENT);

  if (!tables || !header || !shifts) {
    return null;
  }

  const word = (at: number) => header[at] | (header[at + 1] << 8);

  system._keyboardLayout = {
    tables: [0, 1, 2, 3].map((n) => {
      const count = word(COUNTS + n * 2);
      const keys = word(KEYS + n * 2);
      const characters = word(CHARACTERS + n * 2);

      return {
        keys: tables.slice(keys, keys + count),
        characters: tables.slice(characters, characters + (n === 0 ? count * 2 : count)),
        shift: shifts[n * 2],
      };
    }),
  };

  return system._keyboardLayout;
}

/**
 * The key and shift state a character is typed with.
 *
 * @param {Types.UINT} cChar - The character, in its low byte.
 *
 * @returns {Types.UINT} The virtual key in the low byte and the shift state in
 *   the high, or `ffff`.
 */
export async function VkKeyScan(this: any, cChar: number) {
  const character = cChar & 0xff;

  if (character === 0xff) {
    return 0xffff;
  }

  if (character >= 0x41 && character <= 0x5a) {
    return 0x100 | character;
  }

  if (character >= 0x61 && character <= 0x7a) {
    return character - 0x20;
  }

  for (const [n, table] of ((await layout(this))?.tables ?? []).entries()) {
    const index = table.characters.indexOf(character);

    if (index < 0) {
      continue;
    }

    return n === 0
      ? ((table.shift + (index & 1)) << 8) | table.keys[index >> 1]
      : (table.shift << 8) | table.keys[index];
  }

  if (character >= 0x01 && character <= 0x1a) {
    return 0x200 | (character + 0x40);
  }

  return 0xffff;
}

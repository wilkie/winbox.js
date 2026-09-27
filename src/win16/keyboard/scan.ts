'use strict';

import { LAYOUT, NUMPAD_VK, SCAN_LIMIT, SCAN_TO_VK } from './tables.js';

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
 * copies into its data as it starts (seg3 `0194`). winbox.js keeps them
 * itself, as it keeps the driver (`tables.ts`). A layout library is not
 * followed.
 */

interface Layout {
  tables: { keys: Uint8Array; characters: Uint8Array; shift: number }[];
}

/** The layout's tables: winbox.js's own (see `tables.ts`). */
async function layout(_system: any): Promise<Layout | null> {
  return { tables: LAYOUT };
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

/**
 * A key's scan code, a scan code's virtual key, or a key's character.
 * **Read out of `KEYBOARD.DRV`** (seg8 `0000`) and **recorded** by `minis2`,
 * every code of each type:
 *
 * * Type 0: the scan code whose virtual key it is, the first in the table;
 *   else, for the numeric keypad's, 47h on; else nought.
 * * Type 1: the scan code's virtual key. The bound is checked as unsigned
 *   and greater, so the code one past the table reads the byte after it.
 * * Type 2: a digit or a capital is itself; any other key its character
 *   unshifted from the layout, the code's high byte kept; else nought.
 *
 * Only the low byte of the type is looked at.
 *
 * @param {Types.UINT} wCode - The key or scan code.
 * @param {Types.UINT} wMapType - 0, 1 or 2.
 *
 * @returns {Types.UINT} What it maps to, or nought.
 */
export function MapVirtualKey(this: any, wCode: number, wMapType: number) {
  const code = wCode & 0xffff;
  const low = code & 0xff;

  switch (wMapType & 0xff) {
    case 0: {
      const at = SCAN_TO_VK.subarray(0, SCAN_LIMIT).indexOf(low);

      if (at >= 0) {
        return at;
      }

      const pad = NUMPAD_VK.indexOf(low);

      return pad >= 0 ? pad + 0x47 : 0;
    }

    case 1:
      return code > SCAN_LIMIT ? 0 : SCAN_TO_VK[code];

    default: {
      if ((low >= 0x30 && low <= 0x39) || (low >= 0x41 && low <= 0x5a)) {
        return code;
      }

      const [table] = LAYOUT;
      const index = table.keys.indexOf(low);

      if (index >= 0 && table.characters[index * 2] !== 0xff) {
        return (code & 0xff00) | table.characters[index * 2];
      }

      return 0;
    }
  }
}

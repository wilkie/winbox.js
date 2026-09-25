'use strict';

import { MulDiv } from '../../src/win16/gdi/MulDiv.js';
import { parseMenu } from '../../src/win16/user/LoadMenu.js';

/**
 * A menu resource read into a menu, and `MulDiv` as documented.
 */

/** A menu resource: the header, then each item's flags, identifier and text. */
function resource(items: [number, number | null, string][]) {
  const bytes: number[] = [0, 0, 0, 0];

  for (const [flags, id, text] of items) {
    bytes.push(flags & 0xff, flags >> 8);

    if (id !== null) {
      bytes.push(id & 0xff, id >> 8);
    }

    bytes.push(...Array.from(text, (character) => character.charCodeAt(0)), 0);
  }

  return new Uint8Array(bytes);
}

describe('LoadMenu', () => {
  it('reads a menu bar of pop-ups and their items', () => {
    const MF_POPUP = 0x10;
    const MF_END = 0x80;
    const menu = parseMenu(
      resource([
        [MF_POPUP, null, '&File'],
        [0, 1, '&Open'],
        [MF_END, 2, 'E&xit'],
        [MF_POPUP | MF_END, null, '&Help'],
        [MF_END, 3, '&About'],
      ])
    );

    expect(menu.labels).toEqual(['&File', '&Help']);
    expect(menu.items[0].popup!.items.map((item) => [item.id, item.text])).toEqual([
      [1, '&Open'],
      [2, 'E&xit'],
    ]);
    expect(menu.items[1].popup!.items.map((item) => [item.id, item.text])).toEqual([[3, '&About']]);
  });
});

describe('MulDiv', () => {
  it('multiplies and divides, rounding to the nearest', () => {
    expect(MulDiv(10, 3, 4)).toBe(8);
    expect(MulDiv(12, 72, 96)).toBe(9);
    expect(MulDiv(-10, 3, 4)).toBe(-8);
    expect(MulDiv(0xfff6, 3, 4)).toBe(-8);
  });

  it('answers the extreme on overflow or a zero divisor', () => {
    expect(MulDiv(30000, 30000, 1)).toBe(32767);
    expect(MulDiv(-30000, 30000, 1)).toBe(-32768);
    expect(MulDiv(5, 5, 0)).toBe(32767);
  });
});

'use strict';

import { type Icon } from '../../src/layers/groups.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { displayColours, iconIndices, iconPixels } from '../../src/run/group-icon.js';
import { DISPLAY_MODES } from '../../src/win16/display-modes.js';

/**
 * An item's icon drawn from its group file's own bits (`src/run/group-icon.ts`),
 * as the page shows a kept program's groups. That those bits are each
 * program's own icon, decoded as `ExtractIcon` decodes it for the display,
 * is the engine's, held by `crates/winbox-win16/tests/group_icons.rs`.
 */

describe("a group item's icon from its file's bits", () => {
  it('reads the AND plane a bit a pixel and the planes of each row as bits of an index', () => {
    /* 16 by 2, four planes: the mask's first row set, its second clear; the
     * picture's first pixel plane 0 alone (1), its second planes 1 and 3
     * (10), the rest nought. */
    const and = new Uint8Array([0xff, 0xff, 0x00, 0x00]);
    const xor = new Uint8Array(16);

    xor[0] = 0x80; /* row 0, plane 0, pixel 0 */
    xor[2] = 0x40; /* row 0, plane 1, pixel 1 */
    xor[6] = 0x40; /* row 0, plane 3, pixel 1 */
    xor[13] = 0x01; /* row 1, plane 2, pixel 15 */

    const icon: Icon = {
      hotX: 8,
      hotY: 1,
      cx: 16,
      cy: 2,
      widthBytes: 2,
      planes: 4,
      bitsPixel: 1,
      and,
      xor,
    };
    const indices = iconIndices(icon)!;

    expect([...indices.and]).toEqual([...Array(16).fill(1), ...Array(16).fill(0)]);
    expect(indices.xor[0]).toBe(1);
    expect(indices.xor[1]).toBe(10);
    expect(indices.xor[16 + 15]).toBe(4);
    expect([...indices.xor].filter((index) => index).length).toBe(3);

    /* Drawn on the window's white, 15: the screen kept where the mask is
     * set, XORed with the picture; the picture alone where it is clear. */
    const pixels = iconPixels(icon, 'vga')!;
    const colour = (at: number) => [...pixels.subarray(at * 4, at * 4 + 4)];
    const sixteen = DevicePalette.SIXTEEN.colours;

    expect(displayColours('vga').window).toBe(15);
    expect(colour(0)).toEqual([...sixteen[15 ^ 1], 255]);
    expect(colour(1)).toEqual([...sixteen[15 ^ 10], 255]);
    expect(colour(2)).toEqual([255, 255, 255, 255]);
    expect(colour(16)).toEqual([0, 0, 0, 255]);
    expect(colour(31)).toEqual([...sixteen[4], 255]);
  });

  it('reads one plane of eight bits as the index itself, and white on every display', () => {
    const icon: Icon = {
      hotX: 0,
      hotY: 0,
      cx: 2,
      cy: 1,
      widthBytes: 2,
      planes: 1,
      bitsPixel: 8,
      and: new Uint8Array([0x00, 0x00]),
      xor: new Uint8Array([0xfb, 0x07]),
    };

    expect([...iconIndices(icon)!.xor]).toEqual([0xfb, 0x07]);
    expect([...iconPixels(icon, 'vga256')!]).toEqual([
      0xff, 0xff, 0x00, 255, 0xc0, 0xc0, 0xc0, 255,
    ]);

    for (const display of Object.keys(DISPLAY_MODES)) {
      const { palette, window } = displayColours(display);

      expect(palette.colours[window]).toEqual([0xff, 0xff, 0xff]);
    }
  });

  it('refuses bits fewer than the header says', () => {
    const icon: Icon = {
      hotX: 0,
      hotY: 0,
      cx: 32,
      cy: 32,
      widthBytes: 4,
      planes: 4,
      bitsPixel: 1,
      and: new Uint8Array(128),
      xor: new Uint8Array(511),
    };

    expect(iconIndices(icon)).toBeNull();
    expect(iconPixels(icon, 'vga')).toBeNull();
  });
});

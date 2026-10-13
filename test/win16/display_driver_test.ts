'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { displayMode } from '../../src/win16/display-modes.js';
import { displayDriverFor } from '../../src/win16/display-driver.js';
import {
  bitmapsAsAsked,
  displayResourceNumber,
  driverResourceId,
} from '../../src/win16/display-resource-id.js';
import { driverResources } from '../../src/win16/user/driver-resources.js';
import { Escape } from '../../src/win16/gdi/Escape.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { shownColours } from '../../src/raster/shown-colours.js';

/**
 * What the 8514/a's and the XGA's drivers do that the recorded drivers do
 * not, from the read-outs: their `GetDriverResourceID` (`8514.DRV` seg6
 * `02be`, `XGA.DRV` seg3 `008e`, `SVGA256.DRV` seg1 `2d6e`), the 8514/a's
 * static colours as its `Enable` puts them in the DAC (seg1 `2ae9`), its
 * `Control`'s answer to an escape it has not got (seg1 `1b28`), and each
 * driver's export table. No recording is possible on either card.
 */

const BUILD = join(__dirname, '..', '..', 'oracle', 'build');

describe('GetDriverResourceID', () => {
  it.each([
    /* A driver without one is not asked. */
    ['vga', 1, null],
    ['hercules', 32754, null],
    /* At the settings the recorded and the large-font modes run at, every
     * number as it is. */
    ['vga256', 1, 1],
    ['vga256', 32754, 32754],
    ['8514', 1, 1],
    ['8514', 3, 3],
    ['8514', 32754, 32754],
    ['xga256', 1, 1],
    ['xga256', 32767, 32767],
    /* The 8514/a at small fonts: 2000 more for 1 and 3 and above 7F87h. */
    ['8514s', 1, 2001],
    ['8514s', 2, 2],
    ['8514s', 3, 2003],
    ['8514s', 32647, 32647],
    ['8514s', 32648, 34648],
    ['8514s', 32754, 34754],
    ['8514s', 32512, 32512],
    /* The XGA at small fonts: the bitmaps only. */
    ['xga256s', 1, 1],
    ['xga256s', 3, 3],
    ['xga256s', 32734, 34734],
    /* At 640x480: 1, 3 and the bitmaps. */
    ['xga640', 1, 2001],
    ['xga640', 3, 2003],
    ['xga640', 32767, 34767],
  ])('on %s answers %s with %s', (mode, id, answer) => {
    expect(driverResourceId(displayMode(mode), id)).toBe(answer);
  });

  it('is found as the bitmap 2000 below the OEM one', function () {
    expect(displayResourceNumber(displayMode('8514s'), 32754)).toBe(1986);
    expect(displayResourceNumber(displayMode('8514'), 32754)).toBe(32754);
    expect(displayResourceNumber(displayMode('vga'), 32754)).toBe(32754);
  });

  it('gives USER the bitmaps by the numbers it asks', function () {
    const bitmaps = new Map([
      [1966, 'small'],
      [32734, 'large'],
      [7, 'other'],
    ]);

    expect([...bitmapsAsAsked(displayMode('8514'), bitmaps)].sort()).toEqual(
      [
        [1966, 'small'],
        [32734, 'large'],
        [7, 'other'],
      ].sort()
    );
    expect(bitmapsAsAsked(displayMode('8514s'), bitmaps).get(32734)).toBe('small');
    expect(bitmapsAsAsked(displayMode('xga256s'), bitmaps).get(1966)).toBe('small');
  });

  it('is exported by the drivers that have it, and answers', function () {
    for (const [mode, has] of [
      ['vga', false],
      ['hercules', false],
      ['vga256', true],
      ['8514', true],
      ['xga256', true],
    ] as const) {
      expect(`${mode} ${displayDriverFor(displayMode(mode)).exports[450]?.[1]}`).toBe(
        `${mode} ${has ? 'GetDriverResourceID' : undefined}`
      );
    }

    const [answer] = displayDriverFor(displayMode('8514s')).exports[450];

    expect(answer.call({ display: displayMode('8514s') }, 1, 0)).toBe(2001);
    expect(answer.call({ display: displayMode('8514') }, 1, 0)).toBe(1);
  });
});

describe('the display drivers export tables', () => {
  it('has StrBlt take the 1Eh it does, five words fewer than ExtTextOut', function () {
    for (const mode of ['vga', 'hercules', 'vga256', '8514', 'xga256']) {
      const exports = displayDriverFor(displayMode(mode)).exports;

      expect(`${mode} ${exports[11][2]} ${exports[14][2]}`).toBe(`${mode} 30 40`);
    }
  });

  it('has the palette entries only on the 256-colour drivers', function () {
    expect(displayDriverFor(displayMode('vga')).exports[22]).toBeUndefined();
    expect(displayDriverFor(displayMode('8514')).exports[22][1]).toBe('SetPalette');
    expect(displayDriverFor(displayMode('xga256')).exports[548]?.[2]).toBe(8);
    expect(displayDriverFor(displayMode('vga256')).exports[2023][1]).toBe('BltSpecial_Cirrus542X');
  });
});

(existsSync(join(BUILD, 'drive-c-8514')) ? describe : describe.skip)(
  'the 8514/a driver read',
  () => {
    const driver = new Uint8Array(
      readFileSync(join(BUILD, 'drive-c-8514', 'WINDOWS', 'SYSTEM', '8514.DRV'))
    );

    it.each([
      ['8514', 52, 26],
      ['8514s', 36, 18],
    ])('gives USER on %s an OBM_CLOSE %s by %s', (mode, width, height) => {
      const close = driverResources(driver, displayMode(mode)).oem.get(32754);

      expect([close?.width, close?.height]).toEqual([width, height]);
    });
  }
);

describe('the 8514/a static colours on the screen', () => {
  const colours = DevicePalette.forDisplay(displayMode('8514')).colours;

  it('shows a component of 80h as BFh but in 808080, as Enable left them', function () {
    const shown = shownColours(displayMode('8514'), colours, false);

    expect(shown.slice(0, 10)).toEqual([
      [0, 0, 0],
      [0xbf, 0, 0],
      [0, 0xbf, 0],
      [0xbf, 0xbf, 0],
      [0, 0, 0xbf],
      [0xbf, 0, 0xbf],
      [0, 0xbf, 0xbf],
      [0xc0, 0xc0, 0xc0],
      [0xc0, 0xdc, 0xc0],
      [0xa4, 0xc8, 0xf0],
    ]);
    expect(shown[248]).toEqual([0x80, 0x80, 0x80]);
    expect(shown.slice(10)).toEqual(colours.slice(10));
  });

  it('shows the entries once GDI has sent the driver the whole palette', function () {
    expect(shownColours(displayMode('8514'), colours, true)).toEqual(colours);
    expect(shownColours(displayMode('xga256'), colours, false)).toEqual(colours);
  });
});

describe('an escape the driver has not got', () => {
  const machine = (mode: string) => ({
    handles: { resolve: () => ({}) },
    display: displayMode(mode),
  });

  it.each([
    ['8514', 100, 100],
    ['8514s', 39, 39],
    ['8514', 0xc00, 0xc00],
    ['8514', 0x0f, 0],
    ['8514', 0x100, 0],
    ['8514', 0xbff, 0],
    ['8514', 5, 0],
    ['xga256', 100, 0],
    ['vga', 100, 0],
  ])('on %s answers %s with %s', (mode, escape, answer) => {
    expect(Escape.call(machine(mode), 1, escape, 0, 0, 0)).toBe(answer);
  });
});

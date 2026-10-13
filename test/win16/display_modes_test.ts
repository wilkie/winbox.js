'use strict';

import { DISPLAY_MODES, READ_OUT, RECORDED, displayMode } from '../../src/win16/display-modes.js';
import { GetDeviceCaps } from '../../src/win16/gdi/GetDeviceCaps.js';
import { DevicePalette } from '../../src/raster/device-palette.js';

/**
 * The display modes.
 *
 * The recorded ones are checked against real Windows by the API oracle, which
 * is a stronger thing than anything here. The 8514/a and the XGA are not, and
 * cannot be: nothing available emulates either card, so there is nothing to
 * record against. Their numbers are read out of the drivers, and the
 * `GetDeviceCaps` answers below are those read-outs.
 *
 * What is left for all of them is internal consistency, worth having anyway.
 * A mode that claims 256 colours and one bit per pixel is wrong without
 * needing a recording to say so, and a mode missing a field answers zero to a
 * program that asked a real question.
 */

describe('display modes', () => {
  const names = Object.keys(DISPLAY_MODES);

  it('offers both colour depths', function () {
    const depths = new Set(names.map((name) => DISPLAY_MODES[name].colors));

    /* And monochrome besides, which Hercules is; the two the name means are
     * the two a colour display is offered in. */
    expect([16, 256].every((depth) => depths.has(depth))).toBe(true);
  });

  it('says of each mode whether it was measured', function () {
    for (const name of names) {
      expect(`${name}: ${DISPLAY_MODES[name].provenance}`).toMatch(
        new RegExp(`${name}: (${RECORDED}|${READ_OUT})`)
      );
    }
  });

  it('refuses a mode it does not have', function () {
    expect(() => displayMode('cga')).toThrow(/no display mode cga/);
  });

  describe.each(names)('%s', (name) => {
    const mode = DISPLAY_MODES[name];

    it('describes a surface with a size', function () {
      expect(mode.width).toBeGreaterThan(0);
      expect(mode.height).toBeGreaterThan(0);
      expect(mode.widthMillimetres).toBeGreaterThan(0);
      expect(mode.heightMillimetres).toBeGreaterThan(0);
    });

    it('has a colour depth its planes and bits agree with', function () {
      /* Sixteen colours are four one-bit planes; 256 are eight bits in one.
       * A mode that says otherwise is wrong on its face.
       */
      expect(`${name}: ${mode.colors}`).toEqual(
        `${name}: ${Math.pow(2, mode.bitsPerPixel * mode.planes)}`
      );
    });

    it('reports palette capabilities only if it has a palette', function () {
      // A sixteen colour driver reports none of these; a palette device does.
      const palettised = mode.colors > 16;

      expect(`${name}: ${mode.sizePalette > 0}`).toEqual(`${name}: ${palettised}`);
      expect(`${name}: ${mode.numReserved > 0}`).toEqual(`${name}: ${palettised}`);
      expect(`${name}: ${mode.colorRes > 0}`).toEqual(`${name}: ${palettised}`);
    });

    it('has a dot pitch and an aspect that agree about squareness', function () {
      /* Square pixels mean equal dots per inch across and down, and equal
       * aspect terms. EGA has neither, and that consistency is the point.
       */
      const squareDots = mode.logicalPixelsX === mode.logicalPixelsY;
      const squareAspect = mode.aspectX === mode.aspectY;

      expect(`${name}: ${squareDots}`).toEqual(`${name}: ${squareAspect}`);
    });

    it('gives the system metrics that follow from it', function () {
      for (const field of [
        'captionHeight',
        'menuHeight',
        'borderWidth',
        'borderHeight',
        'frameWidth',
        'frameHeight',
        'iconWidth',
        'iconHeight',
      ]) {
        expect(`${name}.${field}: ${mode.metrics[field] > 0}`).toEqual(`${name}.${field}: true`);
      }
    });
  });
});

/**
 * What `GetDeviceCaps` answers on the two drivers DOSBox cannot run, by
 * index, from the read-outs: each driver's `GDIINFO` as its `Enable` leaves
 * it (`8514.DRV` seg6 `0311`, `XGA.DRV` seg3 `0c1c`) on a card with a
 * megabyte, at large fonts, on winbox.js's 486 in protected mode.
 */
describe.each([
  [
    '8514',
    {
      0: 778,
      2: 1,
      4: 280,
      6: 210,
      8: 1024,
      10: 768,
      12: 8,
      14: 1,
      16: -1,
      18: 20,
      20: 0,
      22: 0,
      24: 20,
      28: 0,
      30: 2,
      32: 138,
      34: 8196,
      36: 1,
      38: 2009,
      40: 10,
      42: 10,
      44: 14,
      88: 120,
      90: 120,
      104: 256,
      106: 20,
      108: 18,
    },
  ],
  [
    'xga256',
    {
      0: 778,
      2: 1,
      4: 280,
      6: 210,
      8: 1024,
      10: 768,
      12: 8,
      14: 1,
      16: -1,
      18: 120,
      20: 0,
      22: 0,
      24: 20,
      28: 0,
      30: 2,
      32: 138,
      34: 8708,
      36: 1,
      38: 985,
      40: 10,
      42: 10,
      44: 14,
      88: 120,
      90: 120,
      104: 256,
      106: 20,
      108: 18,
    },
  ],
  [
    '8514s',
    {
      4: 280,
      6: 210,
      8: 1024,
      10: 768,
      12: 8,
      18: 20,
      24: 20,
      34: 8196,
      38: 2009,
      88: 96,
      90: 96,
      104: 256,
      106: 20,
    },
  ],
  [
    'xga256s',
    {
      4: 280,
      6: 210,
      8: 1024,
      10: 768,
      18: 120,
      34: 8708,
      38: 985,
      88: 120,
      90: 120,
    },
  ],
  [
    'xga640',
    {
      4: 280,
      6: 210,
      8: 640,
      10: 480,
      12: 8,
      18: 120,
      24: 20,
      34: 8708,
      38: 985,
      40: 10,
      42: 10,
      44: 14,
      88: 96,
      90: 96,
      104: 256,
      106: 20,
    },
  ],
])('GetDeviceCaps on %s', (name, answers: Record<number, number>) => {
  const machine = { handles: { resolve: () => undefined }, display: displayMode(name) };

  it.each(Object.entries(answers))('answers index %s with %s', (index, answer) => {
    expect(GetDeviceCaps.call(machine, 0, Number(index))).toBe(answer);
  });

  it('is marked read out', function () {
    expect(displayMode(name).provenance).toBe(READ_OUT);
  });

  it('has the 8514/a tenth static colour, a4c8f0, read out of the driver', function () {
    const palette = DevicePalette.forDisplay(displayMode(name));

    expect(palette.colours[9]).toEqual([0xa4, 0xc8, 0xf0]);
    expect(palette.colours[8]).toEqual([0xc0, 0xdc, 0xc0]);
    expect(DevicePalette.forDisplay(displayMode('vga256')).colours[9]).toEqual([0xa6, 0xca, 0xf0]);
  });
});

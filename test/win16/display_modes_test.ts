'use strict';

import { DISPLAY_MODES, MODELLED, RECORDED, displayMode } from '../../src/win16/display-modes.js';

/**
 * The display modes.
 *
 * Three of these are checked against real Windows by the API oracle, which is
 * a stronger thing than anything here. The two 256-colour modes are not, and
 * cannot be: every 256-colour driver Windows 3.1 ships is for a particular
 * card -- Video 7, XGA, 8514/a -- and nothing available emulates one, so there
 * is nothing to record against.
 *
 * What is left for them is internal consistency, which is worth having anyway.
 * A mode that claims 256 colours and one bit per pixel is wrong without
 * needing a recording to say so, and a mode missing a field answers zero to a
 * program that asked a real question.
 */

describe('display modes', () => {
  const names = Object.keys(DISPLAY_MODES);

  it('offers both colour depths', function () {
    const depths = new Set(names.map((name) => DISPLAY_MODES[name].colors));

    expect([...depths].sort((a, b) => a - b)).toEqual([16, 256]);
  });

  it('says of each mode whether it was measured', function () {
    for (const name of names) {
      expect(`${name}: ${DISPLAY_MODES[name].provenance}`).toMatch(
        new RegExp(`${name}: (${RECORDED}|${MODELLED})`)
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

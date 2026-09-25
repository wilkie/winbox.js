'use strict';

import { quarter, roundPoints, shapeOf } from '../../src/raster/curves.js';

/**
 * GDI's curve points, as read out of `GDI.EXE`: the cases the `curves`
 * recordings turned on, pinned here where they are easy to see.
 */
describe('curves', () => {
  it("passes over the point a textbook midpoint walk puts at a circle's diagonal", () => {
    expect(quarter(4, 4)).toEqual([
      [0, 4],
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1],
      [4, 0],
    ]);
  });

  it('walks a tall ellipse on its side and turns it back', () => {
    const wide = quarter(6, 3);
    const tall = quarter(3, 6);

    expect(tall).toEqual(wide.map(([x, y]) => [y, x]).reverse());
  });

  it('makes a rectangle of a corner with no radius', () => {
    expect(roundPoints(0, 0, 9, 4, 1, 1)).toEqual([
      [9, 0],
      [9, 4],
      [0, 4],
      [0, 0],
    ]);
  });

  it('draws nothing for an ellipse a pixel square', () => {
    expect(shapeOf(4, 4, 5, 5, null, 1, 1, true)).toEqual({ pen: [], brush: [] });
  });

  it('keeps the brush inside a wide pen', () => {
    const shape = shapeOf(0, 0, 30, 24, null, 3, 3, true);
    const pen = new Set(shape.pen.map(([x, y]) => `${x},${y}`));

    for (const [y, from, to] of shape.brush) {
      for (let x = from; x < to; x++) {
        expect(pen.has(`${x},${y}`)).toBe(false);
      }
    }
  });
});

/**
 * @jest-environment jsdom
 *
 * Where a glyph's ink stops.
 *
 * A glyph is drawn into a cell as tall as the font asks for, and ink outside it
 * is not drawn -- not clipped to whatever is being drawn onto, clipped to the
 * cell. A hinted outline can leave the cell, because a program may move a point
 * anywhere, and where it does the part outside simply does not appear.
 *
 * That turned up by accident. `times-cvt0-fine` reads a control value by putting
 * a bar where the value says, magnified sixty-four times so that a sixty-fourth
 * of a pixel becomes a whole one; at one size the bar landed five rows below the
 * bottom of the cell and Windows drew nothing, while the same fabrication's
 * other bars, higher up, came back exactly.
 *
 * One bar cannot say where between the two the ink stops, so `times-cell-edge`
 * puts one on each row around the edge and asks. At sixteen the cell is sixteen
 * rows with the baseline on row thirteen: rows thirteen, fourteen and fifteen
 * come back and row sixteen does not, and a bar above row nought does not come
 * back either. At twenty-four, where every one of those rows is inside a taller
 * cell, all six come back.
 */

'use strict';

import { existsSync, readFileSync } from 'node:fs';

const FIXTURE = 'oracle/fixtures/fabricated/glyphs-times-cell-edge.json';

/** The character each bar was written into, and the row it was aimed at. */
const AIMED: Record<string, number> = { W: 13, g: 14, j: 15, '1': 16, '.': -1 };

/** Which rows of the cell carry ink, in the recording. */
function rowsOf(hex: string) {
  const rows: number[] = [];

  for (let row = 0; row < 32; row++) {
    for (let column = 0; column < 32; column++) {
      const bit = row * 4 + (column >> 3);

      if (!(parseInt(hex.slice(bit * 2, bit * 2 + 2), 16) & (0x80 >> (column & 7)))) {
        rows.push(row);
        break;
      }
    }
  }

  return rows;
}

if (!existsSync(FIXTURE)) {
  describe('the bottom of a character cell', () => {
    it.skip('needs the recording; run the oracle pipeline', () => {});
  });
} else {
  describe('the bottom of a character cell', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    const drawn = (height: number, character: string) => {
      const record = fixture.records.find(
        (row: any) =>
          row.args === `"Times New Roman",h=${height},weight=400,italic=0,'${character}'`
      );

      return rowsOf(record.result);
    };

    it('is the last row of the cell, and nothing past it', () => {
      // Sixteen rows, so row fifteen is the last one there is.
      expect(drawn(16, 'W')).toEqual([13]);
      expect(drawn(16, 'g')).toEqual([14]);
      expect(drawn(16, 'j')).toEqual([15]);
      expect(drawn(16, '1')).toEqual([]);
    });

    it('has a top as well as a bottom', () => {
      // Aimed a row above the cell, and it does not come back.
      expect(drawn(16, '.')).toEqual([]);
    });

    it("is the cell's own height and not a fixed number of rows", () => {
      /* Twelve rows at twelve, so the bar that came back at sixteen on row
       * fifteen is past the bottom here and the one before it is not.
       */
      expect(drawn(12, 'W')).toEqual([10]);
      expect(drawn(12, 'g')).toEqual([11]);
      expect(drawn(12, 'j')).toEqual([]);

      // And at twenty-four every one of them is comfortably inside.
      for (const character of Object.keys(AIMED)) {
        expect(drawn(24, character)).toHaveLength(1);
      }
    });
  });
}

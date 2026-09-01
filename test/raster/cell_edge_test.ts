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

/**
 * How far out of its cell an outline may reach before none of it is drawn.
 *
 * `cour-no-instctrl` turns on glyph programs Courier New's own `prep` turns
 * off, and its `w` at eight pixels per em was the last cell of the fabricated
 * set we did not reproduce: Windows drew nothing at all and we drew a blot.
 *
 * Cutting the program short says where that starts. Every cut through
 * instruction 127 renders identically to Windows; at 130 Windows draws nothing.
 * The only instruction between the two that moves a point is the `MDRP` at 128,
 * which divides by a dot product of about a fourteenth and throws a point
 * twenty-six pixels up out of a cell eight rows tall. Whatever Windows does
 * with that outline, it is not to draw the part still inside.
 *
 * `times-tall` asks the question with no hinting in the way: five glyphs that
 * are nothing but an upright bar on the baseline, each taller than the last.
 * What comes back is everything under twice the cell and nothing at or past it.
 *
 * `cour-tall` then puts bars a single row apart around the limit, at the seven
 * sizes Courier New is given, which pins it: the reach is rounded to the
 * nearest row -- the row the top of the outline lands on -- and the glyph is
 * refused when that is twice the cell or more. A bar reaching 35.00 rows in a
 * cell of eighteen is drawn and one reaching 35.55 is not, which is what says
 * the rounding is to the nearest and not upward or downward.
 *
 * And what is counted is bytes rather than rows. A row is padded out to a
 * multiple of thirty-two bits, so every bar up to here -- three pixels wide,
 * and the `w` at eight -- cost four bytes a row and could not tell the two
 * apart. `times-wide` is thirty-six pixels across, eight bytes a row, and is
 * refused at exactly half as many rows. So the budget is eight bytes for every
 * row of the cell, which is two cells of the narrowest row there is.
 */
describe('an outline that reaches out of its cell', () => {
  const TALL = 'oracle/fixtures/fabricated/glyphs-times-tall.json';

  const present = existsSync(TALL) ? describe : describe.skip;

  present('is refused entirely, not clipped', () => {
    const fixture = JSON.parse(readFileSync(TALL, 'utf8'));

    /** The bar in each glyph, in pixels at sixteen where the cell is sixteen. */
    const BARS: Record<string, number> = { W: 8, g: 16, j: 24, '1': 32, '.': 40 };

    const drew = (height: number, character: string) => {
      const record = fixture.records.find(
        (row: any) =>
          row.args === `"Times New Roman",h=${height},weight=400,italic=0,'${character}'`
      );

      return rowsOf(record.result).length > 0;
    };

    it('draws every bar under twice the cell', () => {
      // Sixteen rows: eight, sixteen and twenty-four pixels all come back.
      expect([drew(16, 'W'), drew(16, 'g'), drew(16, 'j')]).toEqual([true, true, true]);

      /* Twenty-three rows at twenty-four, where the same three bars measure
       * twelve, twenty-four and thirty-six pixels and are all still inside.
       */
      expect([drew(24, 'W'), drew(24, 'g'), drew(24, 'j')]).toEqual([true, true, true]);

      // Twelve rows, where the fourth bar measures twenty-three and is as well.
      expect([drew(12, 'j'), drew(12, '1')]).toEqual([true, true]);
    });

    it('measures the reach above the baseline, not the height of the box', () => {
      const reach = JSON.parse(
        readFileSync('oracle/fixtures/fabricated/glyphs-times-reach.json', 'utf8')
      );

      const marked = (character: string) => {
        const record = reach.records.find(
          (row: any) => row.args === `"Times New Roman",h=16,weight=400,italic=0,'${character}'`
        );

        return rowsOf(record.result).length > 0;
      };

      /* Each of these carries a mark by the baseline, well inside the cell, and
       * a bar somewhere else. `W` hangs thirty-two rows below the baseline and
       * `1` four rows of bar thirty rows below it -- boxes of forty-two and
       * thirty-six rows against a limit of thirty-two -- and both marks come
       * back. So the box is not what is measured.
       */
      expect([marked('W'), marked('1')]).toEqual([true, true]);

      // `j` puts the same four rows of bar thirty rows *above*, and it does not.
      expect(marked('j')).toBe(false);

      // And two shapes that stay inside it either way.
      expect([marked('g'), marked('.')]).toEqual([true, true]);
    });

    it('draws none of one that reaches twice it or further', () => {
      expect([drew(16, '1'), drew(16, '.')]).toEqual([false, false]);
      expect([drew(24, '1'), drew(24, '.')]).toEqual([false, false]);

      /* The full stop is not in the wide sweep, so twelve has only the four
       * letters; its fifth bar measures twenty-nine pixels against a cell of
       * twelve and is the one that does not come back.
       */
    });
  });
});

/**
 * The limit, bracketed to a row at every size one face is given.
 *
 * `cour-tall` is five bars a single row apart. Where the bracket falls says
 * both what the limit is twice of and how the reach is rounded before it is
 * compared -- which is to the nearest row, since a bar reaching 35.00 rows in a
 * cell of eighteen comes back and one reaching 35.55 does not.
 */
describe('twice the cell, to the row', () => {
  const FIXTURE = 'oracle/fixtures/fabricated/glyphs-cour-tall.json';

  const present = existsSync(FIXTURE) ? describe : describe.skip;

  present('brackets the limit', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    /** Cell height and pixels per em, as Windows reports and chooses them. */
    const SIZES: [number, number, number][] = [
      [10, 8, 8],
      [12, 12, 9],
      [14, 14, 11],
      [16, 16, 13],
      [18, 18, 16],
      [20, 20, 17],
      [24, 24, 22],
    ];

    /** The bar in each glyph, in whole rows at sixteen pixels per em. */
    const BARS: [string, number][] = [
      ['W', 33],
      ['g', 34],
      ['j', 35],
      ['1', 36],
      ['.', 37],
    ];

    it('agrees with twice the cell at every one of them', () => {
      let asked = 0;

      for (const [height, cell, ppem] of SIZES) {
        for (const [character, rows] of BARS) {
          const record = fixture.records.find(
            (row: any) =>
              row.args === `"Courier New",h=${height},weight=400,italic=0,'${character}'`
          );

          if (!record) {
            continue;
          }

          asked++;

          // The bar is written in units of a row at sixteen pixels per em.
          const reach = Math.round((rows * 128 * ppem) / 2048);

          expect(
            `${cell}/${rows}: ${rowsOf(record.result).length > 0 ? 'drawn' : 'refused'}`
          ).toEqual(`${cell}/${rows}: ${reach >= 2 * cell ? 'refused' : 'drawn'}`);
        }
      }

      // Not every size draws every character; this is what the sweep reaches.
      expect(asked).toBe(29);
    });
  });
});

/**
 * Rows or bytes.
 *
 * `times-wide` is bars thirty-six pixels across, which is eight bytes a row
 * where every earlier bar was four, and short enough that a budget counted in
 * rows would draw all of them. They are refused at half the rows instead.
 */
describe('what the budget counts', () => {
  const FIXTURE = 'oracle/fixtures/fabricated/glyphs-times-wide.json';

  const present = existsSync(FIXTURE) ? describe : describe.skip;

  present('is bytes, not rows', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    const drew = (character: string) => {
      const record = fixture.records.find(
        (row: any) => row.args === `"Times New Roman",h=16,weight=400,italic=0,'${character}'`
      );

      return rowsOf(record.result).length > 0;
    };

    it('refuses a wide bar at half the rows a narrow one reaches', () => {
      /* A cell of sixteen gives thirty-two four-byte rows, and every one of
       * these is well under that. At eight bytes a row it is sixteen, and that
       * is where they stop.
       */
      expect([drew('W'), drew('g')]).toEqual([true, true]);
      expect([drew('j'), drew('1'), drew('.')]).toEqual([false, false, false]);
    });
  });
});

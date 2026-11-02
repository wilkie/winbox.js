'use strict';

/**
 * A run-length encoded DIB's bits, `BI_RLE8` or `BI_RLE4`, walked as the
 * display drivers walk them when they set one into a bitmap or draw it on
 * the screen: `VGA.DRV`'s export 501 (seg9 `12ec`, the set from `13ff`)
 * and `SVGA256.DRV`'s seg9 `15ac`. **Recorded** by `gdidmrle`, into a
 * bitmap's memory with 64 bytes either side, and `rledib`, through
 * `SetDIBits`, `SetDIBitsToDevice` and `StretchDIBits`.
 *
 * A pair of bytes at a time: a count and a value, the value's index that
 * many times -- of four bits its high digit and its low in turn, from the
 * high (`VGA.DRV` `1966`-`19e6`, the run drawn in the high digit and the
 * low over every second pixel; `SVGA256.DRV` `19d3`) -- or nought and an
 * escape: nought ends the line, back to the first column a line up
 * (`1586`; `1647`); one ends the bitmap (`1592`; `1661`); two moves on by
 * the next two bytes, across and up (`1573`; `1609`); three or more is
 * that many indices as they are, of four bits from the high digit
 * (`1d7e`; `1941`), and a byte more where the next is at an odd address
 * (`154b`-`1551`; `15f3`-`1605`) -- the address's, not the stream's.
 *
 * Nothing stops the VGA's walk but the escape that ends the bitmap: lines
 * past the top go on up (`gdidmrle`: written before the bitmap's bits).
 * The 256-colour driver's stops at a line above the top of its clipping
 * rectangle, at an end of line or a delta up (`164a`-`1650`, `1626`-`1631`).
 * Neither bounds a run to the bitmap's width; what is past the right edge
 * goes where the bitmap's memory has it.
 *
 * The decoding is `compression === 1`'s, eight bits; any other the VGA's
 * driver takes as four (`13d9`-`13e0`, its byte 10h compared with 1).
 */
export interface RleWalk {
  /** Eight bits a pixel, or four. */
  eight: boolean;
  /** The stream's byte at an offset from its start. */
  read: (at: number) => number;
  /** Whether an offset from the stream's start is at an odd address. */
  odd: (at: number) => boolean;
  /** The first column, and the first line's row. */
  x: number;
  y: number;
  /** The row above which a line ends the walk: the 256-colour driver's. */
  top: number | null;
  /** A pixel of the DIB's index at a column and row. */
  plot: (x: number, y: number, index: number) => void;
}

/**
 * How far WinBox reads a stream that never ends: Windows reads on through
 * memory to the end of the bitmap's escape or a fault.
 */
const LIMIT = 0x100000;

export function walkRle(walk: RleWalk) {
  const { eight, read, odd, plot } = walk;
  let at = 0;
  let x = walk.x;
  let y = walk.y;

  while (at < LIMIT) {
    const count = read(at);
    const value = read(at + 1);

    at += 2;

    if (count) {
      for (let n = 0; n < count; n++) {
        plot(x + n, y, eight ? value : n & 1 ? value & 0x0f : value >> 4);
      }

      x += count;
      continue;
    }

    if (value === 0) {
      x = walk.x;
      y--;

      if (walk.top !== null && y < walk.top) {
        return;
      }
    } else if (value === 1) {
      return;
    } else if (value === 2) {
      const across = read(at);
      const up = read(at + 1);

      at += 2;
      x += across;
      y -= up;

      if (up && walk.top !== null && y < walk.top) {
        return;
      }
    } else {
      for (let n = 0; n < value; n++) {
        const byte = read(at + (eight ? n : n >> 1));

        plot(x + n, y, eight ? byte : n & 1 ? byte & 0x0f : byte >> 4);
      }

      x += value;
      at += eight ? value : (value + 1) >> 1;

      if (odd(at)) {
        at++;
      }
    }
  }
}

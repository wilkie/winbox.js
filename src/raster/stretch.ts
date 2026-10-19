'use strict';

/**
 * Which source columns and rows each destination column and row of a stretched
 * bitmap is made of: GDI's own stretcher, `GDI.EXE` seg32 `03ba`, as none of
 * the display drivers stretches (`VGA.DRV`'s raster capabilities, `46d9h`,
 * have no `RC_STRETCHBLT`).
 *
 * **Read out**, the colour path (seg32 `099e`), and **recorded** by `stretch`
 * on the VGA: every column and row of sixteen cases, shrinking, enlarging and
 * mirrored, in the three stretch modes. Each axis has an error term starting at
 * the larger size less half the smaller. The two axes differ in when they
 * step: a column steps once its term falls below nought, a row once it
 * reaches nought. Shrinking 16 to 7, the columns shown are
 * 1, 4, 6, 8, 11, 13, 15, and the rows 1, 4, 6, 8, 10, 13, 15.
 */

/**
 * For each of `size` destination columns, the source columns of `from` that
 * fall into it, in the order GDI combines them (seg32 `1268`, `12d3`, `1341`
 * and `13ac`). Mirrored, the source is walked from its right.
 */
export function stretchColumns(from: number, size: number, mirror = false) {
  const groups: number[][] = Array.from({ length: size }, () => []);

  if (from >= size) {
    let error = from - (size >> 1);
    let d = 0;

    for (let i = 0; i < from; i++) {
      groups[d]?.push(mirror ? from - 1 - i : i);
      error -= size;

      if (error < 0) {
        error += from;
        d++;
      }
    }
  } else {
    let error = size - (from >> 1);
    let s = mirror ? from - 1 : 0;

    for (let d = 0; d < size; d++) {
      groups[d].push(s);
      error -= from;

      if (error < 0) {
        error += size;
        s += mirror ? -1 : 1;
      }
    }
  }

  return groups;
}

/**
 * For each of `size` destination rows, top to bottom, the source rows of
 * `from` that fall into it (seg32 `0e96`, `0ed3` and `0eef`). Shrinking in
 * `COLORONCOLOR`, only the row shown is read; in the other modes, every row
 * of its group is combined into it. Mirroring fills the destination from its
 * other end and walks the source the same way.
 */
export function stretchRows(from: number, size: number, combines = false) {
  const groups: number[][] = [];
  let error = Math.max(from, size) - (Math.min(from, size) >> 1);

  if (size < from) {
    let group: number[] = [];

    for (let s = 0; s < from; s++) {
      if (combines) {
        group.push(s);
      }

      error -= size;

      if (error <= 0) {
        error += from;
        groups.push(combines ? group : [s]);
        group = [];
      }
    }
  } else {
    for (let s = 0; s < from; s++) {
      groups.push([s]);
      error -= from;

      while (error > 0) {
        groups.push([s]);
        error -= from;
      }

      error += size;
    }
  }

  return groups.slice(0, size);
}

/**
 * Which source row (or column) each of `size` rows of a `from`-row bitmap
 * stretched shows, `other` and `otherSize` being the other axis, as
 * `COLORONCOLOR` shows it: the scroll bar's arrows, and `StretchBlt`.
 *
 * * **Within a pixel on both axes** (seg32 `0504`): copied as it is, and on
 *   enlarging, the last row and column shown once more.
 * * **Colour** (seg32 `099e`, EGA and VGA): `stretchColumns` and
 *   `stretchRows`, a column showing the last of its group.
 * * **Monochrome** (seg32 `0000`, the Hercules): enlarging, row `d` shows
 *   `(d * from + ceil(from / 2) - 1) / size`; columns are dealt out from the
 *   source, each `size / from` times, the remainder spread one more at a time
 *   from the second. Reducing shows `d * from / size`, rounded down, which is
 *   not read out: only a last row under the bar's outline has shown it.
 *
 * **Read out**, and **recorded** by `chrome` and `noscroll`: the EGA's arrow
 * rows 14 made 16 repeat 3 and 10 and its grayed arrow's 17 columns made 18
 * repeat 7; the Hercules's 11 rows made 16 repeat 1, 3, 5, 7 and 9, and its 15
 * columns made 16 by 11 repeat the last.
 */
export function stretchMap(
  from: number,
  size: number,
  other: number,
  otherSize: number,
  axis: 'rows' | 'columns',
  mono: boolean
) {
  const map: number[] = [];

  if (Math.abs(from - size) <= 1 && Math.abs(other - otherSize) <= 1) {
    for (let d = 0; d < size; d++) {
      map.push(Math.min(d, from - 1));
    }

    return map;
  }

  if (!mono) {
    return axis === 'rows'
      ? stretchRows(from, size).map((group) => group[0])
      : stretchColumns(from, size).map((group) => group[group.length - 1]);
  }

  if (size < from) {
    for (let d = 0; d < size; d++) {
      map.push(Math.floor((d * from) / size));
    }

    return map;
  }

  if (axis === 'columns') {
    const each = Math.floor(size / from);
    const extra = size % from;
    let balance = 0;

    for (let s = 0; s < from; s++) {
      let count = each;

      if (balance > 0) {
        count++;
        balance -= from;
      }

      balance += extra;

      for (let n = 0; n < count && map.length < size; n++) {
        map.push(s);
      }
    }

    return map;
  }

  for (let d = 0; d < size; d++) {
    map.push(Math.min(Math.floor((d * from + Math.ceil(from / 2) - 1) / size), from - 1));
  }

  return map;
}

/**
 * GDI's monochrome stretcher (`GDI.EXE` seg32 `0000`), as `StretchBlt`
 * uses it for a printer's driver without `RC_STRETCHBLT` where neither
 * side is turned over and the two are not both of colours: rows `first` to
 * `last` of the destination, each `size` pixels, a set bit white.
 *
 * Each axis is the larger size against the smaller, a quotient and a
 * remainder. Enlarging across, each source pixel is shown the quotient's
 * times and once more where the remainder's running balance is above
 * nought (`0185`); reducing, each destination pixel is a group of as many,
 * white where all its pixels are (`BLACKONWHITE`, `01ed`), any of them
 * (`WHITEONBLACK`, `0246`), or its first (`COLORONCOLOR`, `029f`). Down,
 * the error starts at the larger less half the smaller, rounded up;
 * enlarging, a row steps the source once the error falls below nought, and
 * the rows between are copies (`0155`, `0129`); reducing, a row takes the
 * source rows until the error falls below nought, anded, ored or the first
 * kept by the same mode (`02f1`). Rows before `first` are passed over by
 * the same steps (`00ef`, `010a`).
 *
 * **Read out**, and **recorded** by `prblt2`.
 */
export function monoStretchRows(
  pixel: (x: number, y: number) => number,
  [sx, sy, sw, sh]: [number, number, number, number],
  dw: number,
  dh: number,
  mode: number,
  first: number,
  last: number
) {
  const growX = dw >= sw;
  const smallX = growX ? sw : dw;
  const quotient = Math.floor((growX ? dw : sw) / smallX);
  const remainder = (growX ? dw : sw) % smallX;
  const growY = dh >= sh;
  const smallY = growY ? sh : dh;
  const largeY = growY ? dh : sh;
  let error = (2 * largeY - smallY) >> 1;
  let row = 0;
  let from = sy;

  while (row < first) {
    if (growY) {
      row++;
      error -= smallY;

      if (error < 0) {
        error += largeY;
        from++;
      }
    } else {
      from++;
      error -= smallY;

      if (error < 0) {
        error += largeY;
        row++;
      }
    }
  }

  const line = (y: number) => {
    const bits = new Uint8Array(sw);

    for (let x = 0; x < sw; x++) {
      bits[x] = pixel(sx + x, y) ? 1 : 0;
    }

    return bits;
  };

  const across = (bits: Uint8Array) => {
    const out = new Uint8Array(dw);
    let balance = 0;
    let at = 0;

    for (let step = 0; step < smallX; step++) {
      let count = quotient;

      if (balance > 0) {
        count++;
        balance -= smallX;
      }

      balance += remainder;

      if (growX) {
        out.fill(bits[step], at, Math.min(at + count, dw));
        at += count;
      } else {
        const group = bits.subarray(at, at + count);

        at += count;
        out[step] =
          mode === 1
            ? Number(group.every((bit) => bit))
            : mode === 2
              ? Number(group.some((bit) => bit))
              : (group[0] ?? 0);
      }
    }

    return out;
  };

  const rows: Uint8Array[] = [];

  while (row <= last) {
    let bits = line(from);

    if (!growY) {
      from++;

      let test = error;

      while ((test -= smallY) >= 0) {
        const next = line(from);

        from++;

        if (mode === 1 || mode === 2) {
          bits = bits.map((bit, x) => (mode === 1 ? bit & next[x] : bit | next[x]));
        }
      }

      error = test + largeY;
    }

    const out = across(bits);

    rows.push(out);
    row++;

    if (growY) {
      error -= smallY;

      let stepped = error < 0;

      if (stepped) {
        error += largeY;
        from++;
      }

      while (!stepped && row <= last) {
        rows.push(out);
        row++;
        error -= smallY;
        stepped = error < 0;

        if (stepped) {
          error += largeY;
          from++;
        }
      }
    }
  }

  return rows;
}

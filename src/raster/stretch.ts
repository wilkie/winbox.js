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

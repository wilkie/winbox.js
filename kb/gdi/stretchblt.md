---
kind: function
module: GDI
name: StretchBlt
ordinal: 35
summary: Copies a rectangle of pixels into a rectangle of another size, stretching or shrinking it, and mirroring it where an extent is negative.
versions:
  '3.1': exact
probes: [stretch]
source: src/win16/gdi/StretchBlt.ts
topics: [accessories]
---

## Observed behaviour

- [[read out]] GDI stretches by itself. `VGA.DRV`'s raster capabilities, `46D9h`, have no `RC_STRETCHBLT`, and it exports no stretching function. `StretchBlt` (`GDI.EXE` seg1 `4be0`) turns both rectangles into device units. Where the two are the same size it is a [[fn:GDI.BitBlt]]; otherwise it goes to GDI's stretcher at seg32 `03ba`.
- [[read out]] Each rectangle is put in order first (seg32 `11bb`). A negative extent from `x` covers `x + extent + 1` to `x + 1`, and mirrors that axis. A negative extent on both sides mirrors nothing.
- [[read out]] Between colour bitmaps, or whenever anything is mirrored, the source is copied into a 4-bit device-independent bitmap, stretched row by row in memory, written back, and combined into the destination under the raster operation (seg32 `099e`).
- [[measured]] [[read out]] **Which columns.** An error term starts at the larger width less half the smaller. Shrinking, it walks every source column, and the destination column moves on each time the term falls **below** nought, the larger width then added back. Enlarging, it walks the destination columns, and the source moves on the same way. 16 columns shrunk to 7 show 1, 4, 6, 8, **11**, 13 and 15.
- [[measured]] [[read out]] **Which rows.** The term starts the same way, but a row is emitted when the term **reaches** nought, not only when it passes it. Enlarging, each source row is repeated while the term stays above nought. 16 rows shrunk to 7 show 1, 4, 6, 8, **10**, 13 and 15, so the two axes differ.
- [[measured]] A mirrored axis walks the source from its other end: 16 columns into −10 show e, d, b, a, 8, 6, 5, 3, 2, 0.
- [[measured]] [[read out]] The stretch mode ([[fn:GDI.SetStretchBltMode]]) says what becomes of the columns and rows that fall together when shrinking. `COLORONCOLOR` shows one of them: the last column of each group, and the one row that is read (the others are never read). `BLACKONWHITE` fills with all ones and **ands** the colour indices of every pixel that falls into a destination pixel; `WHITEONBLACK` fills with nought and **ors** them. Enlarging, the three modes are alike.
- [[measured]] The indices anded and ored are the device-independent copy's. Its colour table is the display driver's own, which has dark grey at 7 and light grey at 8, as its bitmaps do ([[fn:GDI.BitBlt]]). Red, green and yellow anded are light grey.
- [[measured]] Paintbrush shrinks its toolbox pictures, 58 by 279, to 37 by 189 in `COLORONCOLOR`. The error term carries on from one band of rows to the next, and the probe's 279 rows come out as a single run would give them.

[[probe:stretch]] records 294 rows of sixteen cases on the VGA: shrinking, enlarging and mirrored in each axis, the three modes, and both axes at once. winbox.js agrees with all of them.

## Nuances

- Not read out: a stretch to or from a monochrome bitmap, or on the Hercules, which GDI does in another routine (seg32 `0000`) with its own error term. winbox.js follows it only as USER's scroll bar arrows record it ([[topic:scroll-bars]]).
- Not read out: rectangles within a pixel of each other's size on both axes, which GDI copies with `BitBlt`s and a repeated last row or column (seg32 `04fb`).
- Not recorded: `BLACKONWHITE` and `WHITEONBLACK` when a destination row's group spans two bands; mapping modes other than `MM_TEXT`.

## Implementation

`src/raster/stretch.ts` has the column and row rules, which USER's scroll bar arrows share. `StretchBlt` copies the source rectangle into a bitmap of its own format, builds the stretched bitmap in the destination's size by those rules and the stretch mode, and hands it to the same raster-operation engine as [[fn:GDI.BitBlt]], so the brush and the conversions between monochrome and colour are the same.

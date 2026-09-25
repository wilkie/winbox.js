---
kind: function
module: GDI
name: PatBlt
ordinal: 29
summary: Fills a rectangle of a device context with the selected brush, or with white or black, under a raster operation.
versions:
  '3.1': exact
probes: [bitbits]
source: src/win16/gdi/PatBlt.ts
---

## Observed behaviour

- [[measured]] `WHITENESS` and `BLACKNESS` fill exactly the rectangle given, its right and bottom edges outside it: black from column 3 to 10 across rows 1 and 2 of a 24-pixel bitmap, from `PatBlt(3, 1, 8, 2, BLACKNESS)`. Three records of [[probe:bitbits]].
- [[measured]] A fill does not touch a row's padding.
- [[measured]] Every probe that draws starts by filling its cell with `WHITENESS`, and all of their records agree.

## Nuances

- Not yet measured: `PATCOPY`, `PATINVERT`, `DSTINVERT` and the other raster operations, patterned and hatched brushes, and colour bitmaps.

## Implementation

A fill into a bitmap selected into a surface goes to the surface's pixels, where text and lines are drawn and [[fn:GDI.GetBitmapBits]] reads, and to the bitmap's own bits as well. Before [[probe:bitbits]], a monochrome bitmap's fill went only to its own bits, apart from everything drawn over it.

---
kind: function
module: GDI
name: PatBlt
ordinal: 29
summary: Fills a rectangle of a device context with the selected brush, or with white or black, under a raster operation.
versions:
  '3.1': exact
probes: [bitbits, dither, drawgaps, patrops]
source: src/win16/gdi/PatBlt.ts
---

## Observed behaviour

- [[measured]] `WHITENESS` and `BLACKNESS` fill exactly the rectangle given, its right and bottom edges outside it: black from column 3 to 10 across rows 1 and 2 of a 24-pixel bitmap, from `PatBlt(3, 1, 8, 2, BLACKNESS)`. Three records of [[probe:bitbits]].
- [[measured]] A fill does not touch a row's padding.
- [[measured]] Every probe that draws starts by filling its cell with `WHITENESS`, and all of their records agree.
- [[measured]] `PATCOPY` with a solid brush of a colour the display lacks fills a pattern, not the nearest colour. The pattern is eight pixels square and anchored to the device context's origin, not to the rectangle. [[probe:dither]] records 981 fills on each of four displays, and 1,218 fills of monochrome bitmaps. winbox.js reproduces all of them. See [[topic:brush-dithering]].

## Nuances

- [[measured]] A width or height below nought reaches back from the corner given: a height of -1 at row 27 fills row 26. The Towers from Hanoi of the corpus draws its tool bar's bottom edge this way, `PatBlt` at (0, 27) 628 across and -1 down, and Windows' screen shows the line. That is from the screen, not a probe. winbox.js had drawn nothing there.
- [[measured]] Into a monochrome bitmap, a hatched brush draws its lines black whatever its colour: red `HS_DIAGCROSS` fills as black `HS_DIAGCROSS` does. A pattern brush of a monochrome bitmap fills its bits as they are. A pattern brush of a bitmap compatible with the screen, left half red and right half white, fills the red black and the white white ([[probe:drawgaps]]).
- [[measured]] **Every raster operation of the brush and the destination** is its truth table, bit by bit, over the display's colour indices, as [[fn:GDI.BitBlt]]'s are, including those without names. [[probe:patrops]] fills columns of the sixteen colours on the screen. It `PatBlt`s them under each of the sixteen operations, with pattern brushes whose rows are the sixteen colours: all 4,096 pixels follow the table, light and dark grey's indices swapped as `BitBlt`'s are. Each call answers TRUE.
- [[measured]] A hatched brush's gaps are the background colour whether the background mode is `OPAQUE` or `TRANSPARENT`: `PatBlt` does not look at the mode.
- [[measured]] **An operation that reads a source** draws nothing and answers TRUE. `SRCCOPY`, `SRCPAINT`, `SRCINVERT` and `NOTSRCCOPY` all leave the destination as it was. So `PatBlt` does not take the destination for the source: `SRCINVERT` would then have made black. winbox.js had drawn `SRCCOPY` black, as if the source were all noughts.
- Not yet measured: a colour bitmap of a depth other than the display's, and the operations into a monochrome bitmap beyond `PATCOPY`.

## Implementation

A fill into a bitmap selected into a surface goes to the surface's pixels, where text and lines are drawn and [[fn:GDI.GetBitmapBits]] reads, and to the bitmap's own bits as well. Before [[probe:bitbits]], a monochrome bitmap's fill went only to its own bits, apart from everything drawn over it.

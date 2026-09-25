---
kind: function
module: GDI
name: BitBlt
ordinal: 34
summary: Copies a rectangle of pixels from one device context to another, combining source, destination and brush under a raster operation.
versions:
  '3.1': partial
probes: [bitblt]
source: src/win16/gdi/BitBlt.ts
topics: [display-drivers]
---

## Observed behaviour

- [[measured]] Between monochrome bitmaps, every named raster operation is its truth table over the brush, the source and the destination, bit by bit. With a source of `0011` and a destination of `0101`, `SRCCOPY` gives `0011`, `SRCPAINT` `0111`, `SRCAND` `0001`, `SRCINVERT` `0110`, `SRCERASE` `0010`, `NOTSRCCOPY` `1100`, `NOTSRCERASE` `1000`, `MERGEPAINT` `1101` and `DSTINVERT` `1010`. `MERGECOPY`, `PATCOPY`, `PATPAINT` and `PATINVERT` follow the brush: black is `0` and white `1`. 30 records of [[probe:bitblt]], all fifteen operations under both brushes.
- [[measured]] A monochrome bitmap drawn onto a colour one takes its colours from the destination: a `1` bit, white, becomes the background colour, and a `0` bit the text colour. Red text colour and green background, `SRCCOPY`.
- [[measured]] A colour bitmap drawn onto a monochrome one becomes white exactly where a pixel is the source's background colour, and black everywhere else. Two records, green and red as the background colour, over pixels of five colours.
- [[measured]] On a sixteen-colour display, a raster operation between colours works on the display's four-bit colour indices, bit by bit, and not on red, green and blue. Red `SRCAND` blue is light grey; green `SRCPAINT` blue is cyan; red `SRCINVERT` blue is dark magenta.
- [[measured]] The index of each colour is its place in the Windows palette, with light grey and dark grey swapped: black 0000, dark red 0001, dark green 0010, dark yellow 0011, dark blue 0100, dark magenta 0101, dark cyan 0110, **dark grey 0111**, **light grey 1000**, red 1001, green 1010, yellow 1011, blue 1100, magenta 1101, cyan 1110, white 1111. Settled by all sixteen colours `SRCINVERT`ed and `SRCAND`ed onto each of the sixteen, 512 pairs: exclusive-or and `AND` together fix every index up to the order of its four bits, which no raster operation can see.

## Nuances

- [[inferred]] So `SRCAND` of any two colours whose indices share only the top bit is light grey, not dark grey, as red and blue do. A program that masks a sprite in colour relies on this arithmetic, not on colour.
- Not yet measured: colours outside the palette, 256-colour and monochrome displays, `StretchBlt`, patterned and hatched brushes, the operations without names, and a source that overlaps the destination.

## Implementation

winbox.js implements `SRCCOPY`, `NOTSRCCOPY`, `SRCPAINT` and `SRCAND`, on the bitmaps' own bits, with a monochrome source coloured by the destination's text and background colours. The other named operations draw nothing, and colours are combined as red, green and blue, not as indices. None of the [[probe:bitblt]] records are replayed yet. They need one store for a bitmap's pixels: a bitmap loaded from a program's resources holds them in its own bits, while anything drawn into a memory device context lands on the surface, and today's `BitBlt` reads only the first.

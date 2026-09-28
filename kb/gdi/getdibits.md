---
kind: function
module: GDI
name: GetDIBits
ordinal: 441
summary: Reads a device-dependent bitmap back as a DIB, at the bit count the header asks for.
versions:
  '3.1': exact
probes: [getdib]
source: src/win16/gdi/GetDIBits.ts
topics: [palettes]
---

## Observed behaviour

[[probe:getdib]] reads two bitmaps, each 16 by 4, on the VGA. One is a colour bitmap compatible with the screen, with every one of the sixteen colours in it. The other is monochrome, with alternate pixels set. It reads each at every bit count, with and without a buffer for the bits, and all of a few lines.

- [[measured]] A bit count of 1, 4, 8 or 24 is read. A bit count of 0 answers nought and leaves the header as it was.
- [[measured]] The header's image size is filled in: the stride times the bitmap's height, however many lines are asked for. The colour table follows. With no buffer for the bits, that is all that is done, and the answer is the number of lines asked for.
- [[measured]] A colour bitmap's table lists the sixteen colours in the DIB's own order. The two greys are the other way round from the device's indices: light grey is 8 in the DIB and 7 on the device. At 8 bits, the entries after the sixteen are nought. At 24 bits there is no table, and each pixel is its colour, blue first.
- [[measured]] At 1 bit the table is black and white, and a pixel is white where the display driver makes its colour white on a monochrome bitmap: the bright colours and light grey.
- [[measured]] A monochrome bitmap read at 4 bits has a table that is black except for its last entry, which is white. Its white pixels are that last entry.
- [[measured]] The lines are counted from the bottom, starting at `uStartScan`. The answer is how many lines were read. The bytes after a line's pixels, up to its four-byte end, are left as they were.

winbox.js agrees with all 34 records. Championship Slots of the corpus reads its pictures back this way.

## Nuances

- Not recorded: a monochrome bitmap at 8 bits, which winbox.js reads as at 4, with white the last entry; `DIB_PAL_COLORS`, which it reads as `DIB_RGB_COLORS`; the displays other than the VGA.

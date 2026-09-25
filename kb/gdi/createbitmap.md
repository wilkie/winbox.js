---
kind: function
module: GDI
name: CreateBitmap
ordinal: 48
summary: Makes a device-dependent bitmap of a given size and depth, optionally from bits the caller supplies in rows padded to 16-bit words.
versions:
  '3.1': exact
probes: [bitbits]
source: src/win16/gdi/CreateBitmap.ts
---

## Observed behaviour

- [[measured]] The bits are read in rows padded to 16-bit words: a counting pattern given for bitmaps 8, 16, 24, 32 and 40 pixels wide comes back through [[fn:GDI.GetBitmapBits]] in the same order, rows of 2, 2, 4, 4 and 6 bytes. Five records of [[probe:bitbits]].
- [[measured]] Made with no bits, the bitmap is not cleared: its padding held the bytes of a bitmap freed just before it. See [[fn:GDI.GetBitmapBits]].

## Nuances

- The planes and the bits per pixel are read as bytes: a caller passing `0xab01` for the bits per pixel gets a monochrome bitmap. SkiFree does this. Not yet recorded.
- Not yet measured: more than one bit per pixel, more than one plane, and widths that are not a whole number of bytes.

## Implementation

winbox.js reads the caller's rows at their word stride into the four-byte rows it keeps (`src/win16/gdi/ddb.ts`). Until [[probe:bitbits]] it read them as four-byte rows, which moved every row after the first of any bitmap whose width is not a multiple of 32 pixels.

---
kind: function
module: GDI
name: CreateBitmap
ordinal: 48
summary: Makes a device-dependent bitmap of a given size and depth, optionally from bits the caller supplies in rows padded to 16-bit words.
versions:
  '3.1': exact
probes: [bitbits, patmono]
source: src/win16/gdi/CreateBitmap.ts
---

## Observed behaviour

- [[measured]] The bits are read in rows padded to 16-bit words: a counting pattern given for bitmaps 8, 16, 24, 32 and 40 pixels wide comes back through [[fn:GDI.GetBitmapBits]] in the same order, rows of 2, 2, 4, 4 and 6 bytes. Five records of [[probe:bitbits]].
- [[measured]] Made with no bits, the bitmap is not cleared: its padding held the bytes of a bitmap freed just before it. See [[fn:GDI.GetBitmapBits]].

## Nuances

- The planes and the bits per pixel are read as bytes: a caller passing `0xab01` for the bits per pixel gets a monochrome bitmap. SkiFree does this. Not yet recorded.
- [[measured]] **Any shape is made, but a device context takes only two.** [[probe:patmono]] asks for bitmaps 16 by 2 of one plane of one, four, eight and 24 bits, and three and four planes of one. Each is made, and [[fn:GDI.GetObject]] tells its planes and bits as they were asked for, each plane's row rounded to a word. A memory device context compatible with the screen takes the monochrome bitmap and the display's own shape, four planes of one bit on the VGA. [[fn:GDI.SelectObject]] refuses the rest, one plane of four bits among them, and answers nought. The same held on the EGA and the Super VGA. The Hercules took only the monochrome bitmap. Those three displays' recordings are not kept as fixtures; the VGA's is.
- [[measured]] A sixteen-colour display's colour bitmap is four planes of a bit a pixel, laid out a row at a time: each row is its four planes in turn, and plane `p` holds bit `p` of each pixel's colour index. See [[fn:GDI.GetBitmapBits]].
- Not yet measured: widths that are not a whole number of bytes, and what such a bitmap does in [[fn:GDI.CreatePatternBrush]].

## Implementation

winbox.js reads the caller's rows at their word stride into the four-byte rows it keeps (`src/win16/gdi/ddb.ts`). Until [[probe:bitbits]] it read them as four-byte rows, which moved every row after the first of any bitmap whose width is not a multiple of 32 pixels. Until [[probe:patmono]] it took one plane of four bits for the sixteen colours, packed two pixels a byte. `GetObject` then said one plane, and rows rounded to four bytes. A bitmap of another shape now keeps only its bytes, and no device context takes it.

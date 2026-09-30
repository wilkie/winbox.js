---
kind: function
module: GDI
name: SetBitmapBits
ordinal: 106
summary: Replaces a bitmap's bits with bits from a buffer, in rows padded to 16-bit words.
versions:
  '3.1': exact
probes: [patmono]
source: src/win16/gdi/SetBitmapBits.ts
---

## Observed behaviour

- [[documented]] The bits are given in the same shape [[fn:GDI.GetBitmapBits]] returns them: rows padded to 16-bit words, which [[probe:bitbits]] recorded for that call and for [[fn:GDI.CreateBitmap]].
- [[measured]] Bits set into a bitmap already selected into a memory device context show there at once: [[probe:patmono]] sets 16 bytes into its colour bitmap 16 by 2 and reads every pixel back with [[fn:GDI.GetPixel]]. The bytes are the display's four planes a row, as [[fn:GDI.GetBitmapBits]] gives them. The call answers the count of bytes, 16.
- Not yet measured: a buffer smaller than the bitmap, and a monochrome bitmap.

## Implementation

winbox.js reads the rows at their word stride into the four-byte rows it keeps (`src/win16/gdi/ddb.ts`). Until this was written it read the same source byte for every byte of the bitmap. It writes the bitmap's own bits, not a surface it is selected into, which is one of the open questions above.

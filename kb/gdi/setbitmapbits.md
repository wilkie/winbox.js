---
kind: function
module: GDI
name: SetBitmapBits
ordinal: 106
summary: Replaces a bitmap's bits with bits from a buffer, in rows padded to 16-bit words.
versions:
  '3.1': unrecorded
source: src/win16/gdi/SetBitmapBits.ts
---

## Observed behaviour

- [[documented]] The bits are given in the same shape [[fn:GDI.GetBitmapBits]] returns them: rows padded to 16-bit words, which [[probe:bitbits]] recorded for that call and for [[fn:GDI.CreateBitmap]].
- Not yet measured: this call itself, its return value, a buffer smaller than the bitmap, and whether bits set here show in a bitmap already selected into a device context.

## Implementation

winbox.js reads the rows at their word stride into the four-byte rows it keeps (`src/win16/gdi/ddb.ts`). Until this was written it read the same source byte for every byte of the bitmap. It writes the bitmap's own bits, not a surface it is selected into, which is one of the open questions above.

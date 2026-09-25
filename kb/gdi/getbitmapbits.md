---
kind: function
module: GDI
name: GetBitmapBits
ordinal: 74
summary: Copies a bitmap's bits into a buffer, in rows padded to 16-bit words, and returns how many bytes it copied.
versions:
  '3.1': exact
probes: [bitbits, glyphs, lines, polyfill]
source: src/win16/gdi/GetBitmapBits.ts
---

## Observed behaviour

- [[measured]] A row is padded to a whole number of 16-bit words, not doublewords. Monochrome bitmaps 8, 16, 24, 32 and 40 pixels wide come back in rows of 2, 2, 4, 4 and 6 bytes, and bits made by [[fn:GDI.CreateBitmap]] come back in the order they were given. Five records of [[probe:bitbits]].
- [[measured]] The bits are what was drawn into the bitmap, not what it was created with. A black rectangle drawn with [[fn:GDI.PatBlt]] into a white 24-pixel bitmap comes back at exactly its columns: `e0 1f` for columns 3 to 10. Three records.
- [[measured]] A buffer smaller than the bitmap gets exactly as many bytes as it holds, and the call returns that count; the rest of the buffer is untouched. Five bytes and one byte of a sixteen-byte bitmap, two records.
- [[measured]] Drawing does not touch a row's padding. In a monochrome bitmap a set bit is white.
- [[measured]] Every probe that records pixels reads its cell back through this call, and every one of those records agrees; see [[probe:glyphs]], [[probe:lines]] and [[probe:polyfill]] among them.

## Nuances

- [[measured]] A bitmap made with no bits at all is not cleared. The first recording of [[probe:bitbits]] found the padding of a new 24-pixel bitmap holding `04 08 0c 10`: the bytes of the 40-pixel bitmap freed just before it, whose memory it had been given. What was there before is not something a record can be replayed against, so the probe now makes its bitmaps from zeroed bits.
- Not yet measured: bitmaps of more than one bit per pixel, a width that is not a whole number of bytes, and a bitmap that is not selected into any device context after being drawn into.

## Implementation

winbox.js keeps a bitmap in rows padded to four bytes, which the raster code relies on and which is right for device-independent bitmaps, and re-rows at this edge (`src/win16/gdi/ddb.ts`). A monochrome bitmap selected into a device context is read from the surface's pixels, where text and lines are drawn. Until [[probe:bitbits]] was written this call wrote every byte to the buffer's first address, from the bitmap as it was created, in rows padded to four bytes: none of the recordings could see it, because none of the replays called it. To record it yourself, see [[guide:reproducing]].

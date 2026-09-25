---
kind: function
module: GDI
name: GetPixel
ordinal: 83
summary: Returns the colour of one pixel of a device context as a COLORREF.
versions:
  '3.1': exact
probes: [bitblt]
source: src/win16/gdi/GetPixel.ts
---

## Observed behaviour

- [[measured]] Every colour [[probe:bitblt]] records was read with this call: sixteen colours of the palette, set with `SetPixel` and read back unchanged, and the results of `BitBlt` between them. 38 records of 32 pixels each agree through it.

## Nuances

- Not yet measured: a colour outside the palette, which a sixteen-colour display cannot hold, and a point outside the bitmap.

## Implementation

For a bitmap selected into a memory device context, the colour of the pixel's palette index; see [[fn:GDI.BitBlt]]. Until [[probe:bitblt]] this call was a stub.

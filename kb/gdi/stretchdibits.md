---
kind: function
module: GDI
name: StretchDIBits
ordinal: 439
summary: Draws a rectangle of a device-independent bitmap stretched into a rectangle of a device, as StretchBlt would from a bitmap made of it.
versions:
  '3.1': exact
probes: [dibdev]
source: src/win16/gdi/dib-to-device.ts
topics: [painting]
---

## Observed behaviour

[[measured]] [[probe:dibdev]] draws the same seven-by-five DIB as for [[fn:GDI.SetDIBitsToDevice]], into a sixteen-by-twelve bitmap of the display's format.

- Drawn the same size, grown two to one, shrunk to four by three, and from part of the DIB, the destination is what [[fn:GDI.StretchBlt]] makes from a bitmap holding the DIB, in the same stretch mode. That includes `BLACKONWHITE`'s anding of colour indices.
- The source rectangle is counted from the DIB's bottom row.
- A negative destination width or height turns it over, as for `StretchBlt`.
- The raster operation is used: `SRCINVERT` over grey gives each digit exclusive-ored with 8.
- It answers the source rectangle's height: 5 for the whole DIB, 2 for a rectangle two rows high.
- Unlike `SetDIBitsToDevice`, it draws into a memory device context.

winbox.js agrees with all 16 records.

## Nuances

- Not measured: a mapping mode, a negative source extent, `DIB_PAL_COLORS`, and compressed bits.

## Implementation

`StretchDIBits` reads the DIB into a bitmap of the destination's format and hands it to `stretchDevice`, the stretcher `StretchBlt` uses, with the source rectangle turned the right way up.

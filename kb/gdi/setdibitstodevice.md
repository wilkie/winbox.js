---
kind: function
module: GDI
name: SetDIBitsToDevice
ordinal: 443
summary: Draws some of a device-independent bitmap's scan lines straight onto a device, at their place in a rectangle of it.
versions:
  '3.1': exact
probes: [dibdev]
source: src/win16/gdi/dib-to-device.ts
topics: [painting]
---

## Observed behaviour

[[measured]] [[probe:dibdev]] draws a DIB seven by five at four bits a pixel. Its colour table is the display's sixteen colours, so each pixel's value is a digit of the palette. The pixel in column x of row y, counting rows from the bottom as a DIB stores them, is x + 3y mod 16. The probe draws it into a pop-up window of sixteen by twelve at the screen's corner, and reads the window back pixel by pixel.

- The source rectangle, `xSrc`, `ySrc`, `cx` and `cy`, is counted from the DIB's bottom row. Its bottom row is drawn at the bottom of the destination rectangle, so scan line `s` goes to `yDest + ySrc + cy - 1 - s`.
- A rectangle larger than the DIB draws the DIB at its bottom left.
- The bits are `cScanLines` scan lines starting at `uStartScan`, and only those are drawn, at their places. A program can hand a DIB over in bands.
- It answers how many scan lines it drew. Those clipped off by the window are not counted: seven by five at 13,9 in a window twelve high answers 3.
- A one-bit and an eight-bit DIB draw their colour tables' colours.
- [[measured]] Into a memory device context it draws nothing and answers -1, even into a bitmap of the display's own format. The VGA driver takes only the screen. [[fn:GDI.StretchDIBits]] draws into one.

winbox.js agrees with all 36 records.

## Nuances

- Not measured: a mapping mode, where winbox.js maps only the place, `DIB_PAL_COLORS`, and compressed bits.

## Implementation

`src/win16/gdi/dib-to-device.ts` reads the header, colour table and scan lines into a bitmap of the destination's format with the same code as [[fn:GDI.CreateDIBitmap]], and copies the scan lines in range with the raster-operation engine.

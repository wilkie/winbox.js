---
kind: function
module: GDI
name: StretchDIBits
ordinal: 439
summary: Draws a rectangle of a device-independent bitmap stretched into a rectangle of a device, as StretchBlt would from a bitmap made of it.
versions:
  '3.1': partial
probes: [dibdev, prdraw, prblt2, rledib]
source: crates/winbox-win16/src/gdi/printer_output.rs
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

## Straight to the device, and a compressed DIB

[[read out]] On a context that is not a memory one, of a device with `RC_DIBTODEV`, with the destination's width and height in the device's units those of the source, neither nought, and `SRCCOPY`, GDI draws by [[fn:GDI.SetDIBitsToDevice]] of the source rectangle at the destination with every scan line, and answers what it answers (`GDI.EXE` seg11 `1253`-`12c4`). Else it sets the DIB into a bitmap of its own of the DIB's size, compatible with the context, and stretches that (`12ca`-`12f9`).

[[measured]] [[probe:rledib]], run-length encoded DIBs: unstretched on a window, as `SetDIBitsToDevice` draws it, answering 1; stretched, or into a memory context, the DIB as [[fn:GDI.SetDIBits]] sets it, stretched, answering the source's height. The pixels the stream leaves in GDI's bitmap are what that bitmap's memory held -- earlier bitmaps' pixels in DOSBox -- which WinBox, its bitmap nought, does not have (`leftover`, known gaps).

## Nuances

- Not measured: a mapping mode, a negative source extent, `DIB_PAL_COLORS`, and compressed bits.

## On a printer driver's context

[[read out]] On a printer driver's context whose `dpRaster` has `RC_STRETCHDIB` (`GDI.EXE` seg11 `1058`), the driver's `StretchDIBits`, ordinal 28, is given the destination mapped, the source, and the bits and header as the program gave them. It goes once for each of the visible region's rectangles within the destination, from the bottom up, with the raster operation, the brush, the `DRAWMODE` and the rectangle as the clip. The answer is the source's height. [[measured]] [[probe:prdraw]] stretches an 8 by 8 DIB ten times through the PostScript driver; WinBox agrees. For a driver without it, or that answers -1, GDI makes a bitmap compatible with the printer's of the DIB, as [[fn:GDI.CreateDIBitmap]] makes it, and `StretchBlt`s from it ([[fn:GDI.StretchBlt]]), answering the source's height where it drew. [[measured]] [[probe:prblt2]]. See [[topic:printer-drivers]].

## Implementation

`StretchDIBits` reads the DIB into a bitmap of the destination's format and hands it to `stretchDevice`, the stretcher `StretchBlt` uses, with the source rectangle turned the right way up.

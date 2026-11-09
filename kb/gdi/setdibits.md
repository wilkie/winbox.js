---
kind: function
module: GDI
name: SetDIBits
ordinal: 440
summary: Sets some or all of a bitmap's scan lines from a device-independent bitmap, counted from its bottom row, and answers how many it set.
versions:
  '3.1': exact
probes: [gdidraw, deskdeep, prblt2]
source: crates/winbox-win16/src/gdi/printer_stretch.rs
topics: [palettes, printer-drivers]
---

## Observed behaviour

[[probe:gdidraw]] sets a bitmap 8 by 4, compatible with the screen, from DIBs, and copies it to the screen to read it. [[measured]]

- A four-bit DIB with the sixteen palette colours sets every pixel to its colour, and a one-bit DIB with red and blue its two. Each answers 4, the scan lines set.
- Given scan lines 1 and 2 only, it sets the two rows they are, counted from the bitmap's bottom row as a DIB is stored, and leaves the rest as they were. It answers 2.

[[fn:GDI.CreateDIBPatternBrush]] makes a pattern brush from a packed DIB in a global block the same way: [[probe:gdidraw]] fills a cell with one from a four-bit DIB and one from a one-bit DIB of red and white, from the device context's origin.

winbox.js agrees with all of these records. Both were stubs.

[[probe:deskdeep]] sets an 8-by-8 DIB of 16, 24 and 32 bits a pixel into a white bitmap of the screen's, on the VGA and the 256-colour display. [[measured]]

- 24 bits answer 8, each pixel matched on its own: green (100, 200, 50) is bright green on the VGA, by its driver's rule, and olive on the 256-colour display, the nearest of the static colours with no palette selected.
- 16 and 32 bits answer nought and set nothing. [[read out]] The display driver takes 1, 4, 8 and 24 bits and one plane, and answers nought for anything else (VGA.DRV seg9 `0059`-`0080`, SVGA256.DRV seg9 `0197`-`01be`); GDI hands the bits to its `DeviceBitmapBits` (`GDI.EXE` seg11 `091e`).

## A compressed DIB

[[probe:rledib]] sets run-length encoded DIBs, `BI_RLE8` and `BI_RLE4`, into a bitmap 16 by 8 of the screen's, filled first, on the VGA and the 256-colour display. [[measured]]

- The runs, the absolute runs of odd lengths and their padding, the deltas and the ends of line set what the format says; what the stream leaves -- a line ended short, a delta's gap, the lines after the bitmap's end -- is left as it was. A run of four bits is its high digit and its low in turn from the run's first pixel. The answer is 1, whatever the scan lines.
- On the VGA the first line is the bitmap's bottom row less the start, whatever the DIB's height and the count: a DIB four high goes at the bottom; from scan line 2, two rows up. On the 256-colour display it is the DIB's height less one, the start not read: a DIB four high goes at the top.
- A run past the right edge: on the VGA its pixels go into the next plane's row of the same row, so the first pixels' colours are changed a plane up, and the last plane's into the row below's first plane; on the 256-colour display into the row below.
- Lines past the top: on the 256-colour display they end it. [[read out]] On the VGA they go on up, before the bitmap's bits (`VGA.DRV` seg9 `1586`; [[probe:gdidmrle]] sees them written there), which a probe through GDI does not ask.
- A monochrome bitmap: on the VGA each colour white where the driver takes it as white; the 256-colour driver refuses it and the answer is nought.

[[read out]] GDI hands the DIB to the driver's `DeviceBitmapBits` as it is; the drivers' routines are [[fn:GDI.DMDibBits]]'s. `crates/winbox-win16/src/gdi/rle_dib.rs`; [[probe:rledib]] agrees.

## With a printer's context

[[read out]] With the context of a printer's driver that has no `RC_DI_BITMAP`, GDI sets the bits itself (`GDI.EXE` seg11 `094c`, seg12 `094f`). The scans become a monochrome bitmap of its own, each colour white where its blue, twice its red and five times its green come to 1020 or more. The driver's `BitBlt` copies it into the bitmap, through a memory context made compatible with the printer's. A compressed DIB answers 1. [[measured]] [[probe:prblt2]]. See [[topic:printer-drivers]].

## Nuances

- Not recorded: `DIB_PAL_COLORS`, and an uncompressed DIB taller or shorter than the bitmap.
- A compressed DIB on the Hercules is read as the format says, not as its driver reads it, which no probe has asked.
- A DIB of 24 bits is taken by [[fn:GDI.CreateDIBitmap]], [[fn:GDI.SetDIBitsToDevice]] and [[fn:GDI.StretchDIBits]] the same way, each pixel matched; only `SetDIBits` is recorded at 24 bits.

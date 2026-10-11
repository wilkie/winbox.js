---
kind: function
module: GDI
name: SetDIBits
ordinal: 440
summary: Sets some or all of a bitmap's scan lines from a device-independent bitmap, counted from its bottom row, and answers how many it set.
versions:
  '3.1': exact
probes: [gdidraw, deskdeep]
source: src/win16/gdi/gdi-draw.ts
topics: [palettes]
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

## Nuances

- Not recorded: `DIB_PAL_COLORS`, and a DIB taller or shorter than the bitmap.
- A DIB of 24 bits is taken by [[fn:GDI.CreateDIBitmap]], [[fn:GDI.SetDIBitsToDevice]] and [[fn:GDI.StretchDIBits]] the same way, each pixel matched; only `SetDIBits` is recorded at 24 bits.

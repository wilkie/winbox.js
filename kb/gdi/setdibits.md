---
kind: function
module: GDI
name: SetDIBits
ordinal: 440
summary: Sets some or all of a bitmap's scan lines from a device-independent bitmap, counted from its bottom row, and answers how many it set.
versions:
  '3.1': exact
probes: [gdidraw]
source: src/win16/gdi/gdi-draw.ts
topics: [palettes]
---

## Observed behaviour

[[probe:gdidraw]] sets a bitmap 8 by 4, compatible with the screen, from DIBs, and copies it to the screen to read it. [[measured]]

- A four-bit DIB with the sixteen palette colours sets every pixel to its colour, and a one-bit DIB with red and blue its two. Each answers 4, the scan lines set.
- Given scan lines 1 and 2 only, it sets the two rows they are, counted from the bitmap's bottom row as a DIB is stored, and leaves the rest as they were. It answers 2.

[[fn:GDI.CreateDIBPatternBrush]] makes a pattern brush from a packed DIB in a global block the same way: [[probe:gdidraw]] fills a cell with one from a four-bit DIB and one from a one-bit DIB of red and white, from the device context's origin.

winbox.js agrees with all of these records. Both were stubs.

## Nuances

- Not recorded: `DIB_PAL_COLORS`, and a DIB taller or shorter than the bitmap.

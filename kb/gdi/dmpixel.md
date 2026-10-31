---
kind: function
module: GDI
name: DMPixel
ordinal: 209
summary: A pixel of a memory bitmap set under a raster operation, or read as a physical colour, by the display driver's Pixel -- for a printer's driver.
versions:
  '3.1': partial
probes: [gdidm]
records: [pixel, bits, notbitmap]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] calls it on a `BITMAP` of the probe's, 16 by 8, of four planes and of one, on the VGA.

- [[measured]] `DMPixel(lpDestDev, x, y, dwPhysColor, lpDrawMode)` with a `DRAWMODE` sets the pixel and answers nought. Each plane's bit is the `DRAWMODE`'s raster operation of the pen's bit and the bit there: all sixteen were drawn, from `R2_BLACK` to `R2_WHITE`. The pen's bits are the physical colour's index, from its top byte; for a monochrome bitmap the white flag, 10h of the top byte.
- [[measured]] Each row of the four-plane bitmap is four rows of bits, plane nought first, a pixel's index the four bits it has, bit 7 of a byte the leftmost.
- [[measured]] With no `DRAWMODE` it answers the pixel's physical colour, as [[fn:GDI.DMColorInfo]] makes them: index 4 is `04800000`, magenta `1DFF00FF`. In a monochrome bitmap a set bit is `3FFFFFFF`, a clear one `20000000`.
- [[measured]] A point at or past the width or the height, or with a coordinate below nought, answers `80000000`, set or read, and draws nothing.
- [[measured]] For a device whose first word is not nought the answer's high word is 20h.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0154`: `mov cx,200Ch` and a jump to [[fn:GDI.Brute]], which calls the display driver's `Pixel` for a memory bitmap. `VGA.DRV`'s (seg7 `0088`) compares the point with the width and height unsigned (`009d`-`00ab`), finds the row past as many 64 KiB segments as `bmScanSegment` rows fill, each `bmSegmentIndex` selectors on (`00e2`-`00fa`), four planes' rows for a word 8 of 104h (`0103`-`010e`), and with no `DRAWMODE` reads each plane's bit and makes the physical colour (`020d`-`024d`); a monochrome bitmap's answer is fixed (`01f9`-`020b`). With one, it jumps through a table by the raster operation less one (`01c1`-`01e1`).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

In both engines as the VGA's driver has it. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. On the Hercules and the 256-colour display a memory bitmap answers nought. [[probe:gdidm]] agrees in both engines.

**Recommendation:** done for the VGA, the Super VGA and the EGA.

## Not yet done

- The Hercules's and the 256-colour display's own, whose physical colours are not the VGA's ([[topic:gdi-internals]]).

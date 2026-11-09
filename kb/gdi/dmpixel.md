---
kind: function
module: GDI
name: DMPixel
ordinal: 209
summary: A pixel of a memory bitmap set under a raster operation, or read as a physical colour, by the display driver's Pixel -- for a printer's driver.
versions:
  '3.1': partial
probes: [gdidm, gdidmpx]
records: [pixel, bits, notbitmap]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] calls it on a `BITMAP` of the probe's, 16 by 8, of four planes and of one, on the VGA.

- [[measured]] `DMPixel(lpDestDev, x, y, dwPhysColor, lpDrawMode)` with a `DRAWMODE` sets the pixel and answers nought. Each plane's bit is the `DRAWMODE`'s raster operation of the pen's bit and the bit there: all sixteen were drawn, from `R2_BLACK` to `R2_WHITE`. The pen's bits are the physical colour's index, from its top byte; for a monochrome bitmap the white flag, 10h of the top byte.
- [[measured]] Each row of the four-plane bitmap is four rows of bits, plane nought first, a pixel's index the four bits it has, bit 7 of a byte the leftmost.
- [[measured]] With no `DRAWMODE` it answers the pixel's physical colour, as [[fn:GDI.DMColorInfo]] makes them: index 4 is `04800000`, magenta `1DFF00FF`. In a monochrome bitmap a set bit is `3FFFFFFF`, a clear one `20000000`.
- [[measured]] A point at or past the width or the height, or with a coordinate below nought, answers `80000000`, set or read, and draws nothing.
- [[measured]] For a device whose first word is not nought the answer's high word is 20h.
- [[measured]] [[probe:gdidmpx]] on the Hercules: every bitmap is one plane of a bit to its driver, the pen white where its physical colour has the white flag; a pixel read answers 3FFFFFFFh for a set bit and 20000000h for a clear one.
- [[measured]] On the 256-colour display, a bitmap a byte a pixel takes each raster operation on the pixel's byte, the pen the physical colour's low byte; a pixel read answers FF00h above the byte. A monochrome bitmap's pen is the low byte's bit nought, and a pixel read answers FF0000FFh set and FF000000h clear.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0154`: `mov cx,200Ch` and a jump to [[fn:GDI.Brute]], which calls the display driver's `Pixel` for a memory bitmap. `VGA.DRV`'s (seg7 `0088`) compares the point with the width and height unsigned (`009d`-`00ab`), finds the row past as many 64 KiB segments as `bmScanSegment` rows fill, each `bmSegmentIndex` selectors on (`00e2`-`00fa`), four planes' rows for a word 8 of 104h (`0103`-`010e`), and with no `DRAWMODE` reads each plane's bit and makes the physical colour (`020d`-`024d`); a monochrome bitmap's answer is fixed (`01f9`-`020b`). With one, it jumps through a table by the raster operation less one (`01c1`-`01e1`).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

[[read out]] `HERCULES.DRV` seg5 `0010`: a point at or past the width or the height, unsigned, DX 8000h (`0070`); the row past the segments the rows before fill (`0078`-`009f`), `bmWidthBytes` a row whatever the planes; no `DRAWMODE` answers by the bit (`00fc`-`0106`); otherwise the raster operation less one indexes a table of two jumps a pen's bit (`011f`): clear, invert, set or leave the bit, each falling to AX and DX nought.

[[read out]] `SVGA256.DRV` seg7 `0048`: the same bounds (`00d1`); `bmPlanes` and `bmBitsPixel` 801h a byte a pixel, the pen the colour's low byte (`00fa`-`0107`), else a bit at `x / 8` with a pen of 1 -- but where `bmWidthBytes` is odd the bit's bitmap is taken a byte at a time too (the test of DL at `0149`, DL the width's bytes). A byte's raster operation by tables at `0000`-`003f`: an AND and XOR of the pen and then a store, AND, OR or XOR, or for the four that need it a merge (`0184`-`01a2`). A read answers FF00h in DX (`01d5`-`01ec`).

## Implementation

As the VGA's driver has it. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. [[probe:gdidm]] agrees.

**Recommendation:** done for the VGA, the Super VGA, the EGA, the Hercules and the 256-colour display.

On the Hercules and the 256-colour display their own (`herculesPixel` in `pixel`, and the Rust twins), [[probe:gdidmpx]] agreeing on all three displays.

## Not yet done

- Nothing on a memory bitmap: every display WinBox has answers as recorded.

---
kind: function
module: GDI
name: DMScanLR
ordinal: 212
summary: The display driver's ScanLR on a memory bitmap -- the first pixel along a row that is, or is not, a colour -- for a printer's driver.
versions:
  '3.1': partial
probes: [gdidm]
records: [scanlr]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] scans rows of a `BITMAP` of the probe's, of four planes and of one, on the VGA.

- [[measured]] `DMScanLR(lpDestDev, x, y, dwPhysColor, wStyle)` looks from the point itself along its row: to the right, or with style bit 1 to the left. It answers the x of the first pixel that is not the colour, or with style bit 0 the first that is. Where the row ends first it answers -1.
- [[measured]] The colour is the physical colour's index for four planes, its white flag for one.
- [[measured]] A point at or past the width or the height, taken unsigned, answers 8000h.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `016e`: `mov cx,2C0Bh` and a jump to [[fn:GDI.Brute]]. `VGA.DRV`'s `ScanLR` (seg5 `02aa`) checks the point (`0326`-`0334`), finds the row as `Pixel` does, and compares a byte at a time: each plane against the colour's bit for four planes (`03b7`-`042d`), the white flag for one (`0431`-`045e`), turned over with style bit 0 (`03f4`-`03fb`). A match in the padding past the width answers -1 (`0476`).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

In both engines as the VGA's driver has it, a pixel at a time. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. On the Hercules and the 256-colour display a memory bitmap answers nought. [[probe:gdidm]] agrees in both engines. [[fn:GDI.ScanLR]] is the same scan on a device context.

**Recommendation:** done for the VGA, the Super VGA and the EGA.

## Not yet done

- The Hercules's and the 256-colour display's own, whose physical colours are not the VGA's ([[topic:gdi-internals]]): no probe calls it there yet.

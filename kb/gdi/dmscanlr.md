---
kind: function
module: GDI
name: DMScanLR
ordinal: 212
summary: The display driver's ScanLR on a memory bitmap -- the first pixel along a row that is, or is not, a colour -- for a printer's driver.
versions:
  '3.1': partial
probes: [gdidm, gdidmpx]
records: [scanlr]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] scans rows of a `BITMAP` of the probe's, of four planes and of one, on the VGA.

- [[measured]] `DMScanLR(lpDestDev, x, y, dwPhysColor, wStyle)` looks from the point itself along its row: to the right, or with style bit 1 to the left. It answers the x of the first pixel that is not the colour, or with style bit 0 the first that is. Where the row ends first it answers -1.
- [[measured]] The colour is the physical colour's index for four planes, its white flag for one.
- [[measured]] A point at or past the width or the height, taken unsigned, answers 8000h.
- [[measured]] [[probe:gdidmpx]] on the Hercules, a monochrome bitmap's rows are scanned a byte at a time across all their bytes, the colour white by its white flag; the answer is as the VGA's.
- [[measured]] On the 256-colour display a bitmap a byte a pixel is scanned for its byte, the colour the physical colour's low byte; to the right the row's last byte is never looked at: from 14 of a row of 16 where 15 is the only other, -1. A monochrome bitmap as the Hercules's, the colour white by bit nought of the physical colour's second byte.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `016e`: `mov cx,2C0Bh` and a jump to [[fn:GDI.Brute]]. `VGA.DRV`'s `ScanLR` (seg5 `02aa`) checks the point (`0326`-`0334`), finds the row as `Pixel` does, and compares a byte at a time: each plane against the colour's bit for four planes (`03b7`-`042d`), the white flag for one (`0431`-`045e`), turned over with style bit 0 (`03f4`-`03fb`). A match in the padding past the width answers -1 (`0476`).

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

[[read out]] `HERCULES.DRV` seg3 `001c`: a point at or past the width or the height, unsigned, 8000h (`0087`); the row as `Pixel` finds it; the point's byte with the bits from the point on masked, then the bytes after with `repe scasb` for one not all of the colour's bit (`00c9`-`012f`); the bit within it to the left by shifting right, to the right by shifting left from its place counted from the row's start, -1 where that reaches the width (`0132`-`0153`); -1 where none (`016c`). The colour's bit is 10h of the physical colour's high byte, style bit 0 inverting it (`0102`-`0116`).

[[read out]] `SVGA256.DRV` seg4 `0154`: the same for a monochrome bitmap (`0246`-`02d8`), the colour's bit nought of the second byte (`027a`); a bitmap a byte a pixel with `repe scasb` for the first byte not the colour (`0231`), or `repne` for the first that is (`023a`), to the left for the point and the bytes before it, to the right for `bmWidthBytes` less the point less one bytes (`0224`-`0229`), the answer where the string stopped less the row's start (`0240`).

## Implementation

In both engines as the VGA's driver has it, a pixel at a time. On the Super VGA and the EGA as on the VGA -- [[probe:gdidm]] recorded on each gives every record the VGA's but the EGA's ninth colour, 404040h, which is not white on a monochrome bitmap. [[probe:gdidm]] agrees in both engines. [[fn:GDI.ScanLR]] is the same scan on a device context.

**Recommendation:** done for the VGA, the Super VGA, the EGA, the Hercules and the 256-colour display.

On the Hercules and the 256-colour display their own (`herculesScanLR` and `monoScan` in `driver-hercules.ts`, `scanLR` in `driver-vga256.ts`, and the Rust twins), [[probe:gdidmpx]] agreeing in both engines on all three displays.

## Not yet done

- Nothing on a memory bitmap: every display WinBox has answers as recorded.

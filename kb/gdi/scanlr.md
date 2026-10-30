---
kind: function
module: GDI
name: ScanLR
ordinal: 135
summary: GDI's call of a device's ScanLR on a device context -- the first pixel along a row that is, or is not, a colour -- as a flood fill makes it.
versions:
  '3.1': partial
probes: [gdiint]
records: [scanlr]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals]
---

## Observed behaviour

[[probe:gdiint]] scans a memory context's bitmap of the display's format and a monochrome one, on the VGA.

- [[measured]] `ScanLR(hdc, x, y, crColor, wStyle)` takes the point in logical units: a viewport's origin moves it. From the point itself along its row, to the right or with style bit 1 to the left, it answers the x of the first pixel that is not the colour as the display draws it, or with style bit 0 the first that is; -1 where the row ends first.
- [[measured]] The colour is matched as the display matches it: `RGB(250, 10, 0)` is red. In a monochrome bitmap a colour the VGA takes as white -- yellow, but not dark red -- scans as white.
- [[measured]] A point past the bitmap, or below nought, answers 8000h. A device context of nought answers -1.

## Inside Windows

[[read out]] `GDI.EXE` seg15 `087f`: the device context brought up to date where its flag 4 at 0Ah says so (seg1 `4423`), nought answering -1; the point taken to device units (seg1 `5373`); the colour made physical by the driver's `ColorInfo`, entry 4 of the context's table at 2Eh; then the driver's `ScanLR`, entry 2Ch, on the context's device at 2Ah, its answer the answer. No clipping. `retf 0Ch`.

## Callers

[[read out]] None imports it. The display drivers export a `ScanLR` of their own, by that name; that is what the census's hint is.

## Implementation

In both engines for a memory context's bitmap of four planes or one, read from WinBox's own pixels as [[fn:GDI.DMScanLR]] reads a bitmap's bits, on the VGA. [[probe:gdiint]] agrees in both.

**Recommendation:** done for memory contexts.

## Not yet done

- A window's or the screen's context, where the driver scans the screen, and the displays other than the VGA: WinBox answers nought.

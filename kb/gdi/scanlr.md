---
kind: function
module: GDI
name: ScanLR
ordinal: 135
summary: GDI's call of a device's ScanLR on a device context -- the first pixel along a row that is, or is not, a colour -- as a flood fill makes it.
versions:
  '3.1': partial
probes: [gdiint, scanscr]
records: [scanlr, window, origin, screen]
source: src/win16/gdi/driver-helpers.ts
topics: [gdi-internals]
---

## Observed behaviour

[[probe:gdiint]] scans a memory context's bitmap of the display's format and a monochrome one, on the VGA.

- [[measured]] `ScanLR(hdc, x, y, crColor, wStyle)` takes the point in logical units: a viewport's origin moves it. From the point itself along its row, to the right or with style bit 1 to the left, it answers the x of the first pixel that is not the colour as the display draws it, or with style bit 0 the first that is; -1 where the row ends first.
- [[measured]] The colour is matched as the display matches it: `RGB(250, 10, 0)` is red. In a monochrome bitmap a colour the VGA takes as white -- yellow, but not dark red -- scans as white.
- [[measured]] A point past the bitmap, or below nought, answers 8000h. A device context of nought answers -1.
- [[measured]] [[probe:scanscr]], on a window's context and the screen's, on the VGA, the Super VGA and the EGA: the display driver scans the screen. The point is moved by the context's origin on the screen and the answer is the screen's x, not the window's: from 0,10 of a window at 40,30 the first pixel not white is answered as 50.
- [[measured]] The whole row of the screen is scanned, past the window's edges and through another window over it -- the pixels on the screen, whatever the context's region. A point off the screen answers 8000h; within the screen but outside the window, it scans there.

## Inside Windows

[[read out]] `GDI.EXE` seg15 `087f`: the device context brought up to date where its flag 4 at 0Ah says so (seg1 `4423`), nought answering -1; the point taken to device units (seg1 `5373`); the colour made physical by the driver's `ColorInfo`, entry 4 of the context's table at 2Eh; then the driver's `ScanLR`, entry 2Ch, on the context's device at 2Ah, its answer the answer. No clipping. `retf 0Ch`.

## Callers

[[read out]] None imports it. The display drivers export a `ScanLR` of their own, by that name; that is what the census's hint is.

## Implementation

In both engines (`driver-helpers.ts`, `driver_helpers.rs`), on the VGA, the Super VGA and the EGA: for a memory context's bitmap of four planes or one, read from WinBox's own pixels as [[fn:GDI.DMScanLR]] reads a bitmap's bits; for a window's or the screen's context, the screen's pixels from the context's origin. [[probe:gdiint]] and [[probe:scanscr]] agree in both.

**Recommendation:** done for those displays.

## Not yet done

- The Hercules and the 256-colour display, where WinBox answers nought.

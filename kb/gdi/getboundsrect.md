---
kind: function
module: GDI
name: GetBoundsRect
ordinal: 194
summary: Answers the bounds of what has been drawn in a device context since they were last reset, in logical units.
versions:
  '3.1': exact
probes: [bounds]
topics: [drawing-bounds]
---

## Observed behaviour

- [[measured]] With nothing kept it answers `DCB_RESET` (1) and writes nothing ([[probe:bounds]]).
- [[measured]] Otherwise it answers `DCB_SET` (3) and the rectangle: cut to the context's area -- a rectangle half off a 200 by 150 bitmap comes back cut at its edge -- and in logical units: under `MM_LOMETRIC`, 101, -202 to 501, -488 for a rectangle given as 100, -200 to 500, -600.
- [[measured]] With `DCB_RESET` in the flags it resets them after.
- [[measured]] With 8000h it answers Windows' own bounds as GDI keeps them, in the screen's coordinates.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `76e4`: `DCB_RESET` where the set flag is clear. Windows' rectangle is copied as kept. The program's is cut to the box of the context's visible region (seg1 `772c`), moved back by the context's corner and turned into logical units (seg1 `52f0`). `DCB_RESET` in the flags then calls `SetBoundsRect` to reset them; the answer is `DCB_SET`.

## Implementation

As read out, the visible region's box being the context's bitmap or client area on the screen. [[probe:bounds]] agrees in both.

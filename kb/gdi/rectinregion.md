---
kind: function
module: GDI
name: RectInRegion
ordinal: 181
summary: Answers whether any of a rectangle lies in a region: 101h or nought.
versions:
  '3.1': exact
probes: [regions, gdimisc]
records: [rect, ehh]
topics: [regions]
---

## Observed behaviour

- [[measured]] 257 for a rectangle that touches a region, nought for one beside it; one the wrong way round, 40, 40, 30, 30, is put in order ([[probe:regions]]).
- [[measured]] From a program made for Windows 3.00, an empty rectangle 5, 5, 5, 5 inside a region answers 257, and -5, -5, 0, 0 beside one from 2, 2 answers nought: the rectangle is grown a pixel at its right and bottom ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `4ce6` checks the handle and jumps to `RectInRegion_Ehh` (seg1 `2aab`): `GetExpWinVer` of the caller's code segment; the rectangle put in order -- a right not past its left swapped with it, and so the bottom -- and, for a caller made for Windows 3.00 or before, its right and bottom moved on a pixel; then walked against the region (`2b62`, `2c7c`): 1 in AL and 1 in AH, from the walk's mode word 183h, where any of it is in; nought where none.

## Implementation

As read out; the caller is the module whose code segment called. [[probe:regions]] and [[probe:gdimisc]] agree in both.

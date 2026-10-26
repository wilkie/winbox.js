---
kind: function
module: GDI
name: RectVisible
ordinal: 104
summary: Answers whether any of a rectangle lies where a device context draws: 101h or nought.
versions:
  '3.1': exact
probes: [gdimisc]
records: [ehh]
topics: [clip-regions]
---

## Observed behaviour

- [[measured]] 257 for a rectangle in a memory context's bitmap, and for 5, 5, 5, 5 and -5, -5, 0, 0, and 20, 20, 10, 10, from a program made for Windows 3.00: an empty rectangle is grown a pixel, and one the wrong way round put in order ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `4d06` checks the handle and jumps to `RectVisible_Ehh` (seg1 `29b7`): the rectangle mapped to the device, put in order, its right and bottom moved on a pixel for a caller made for Windows 3.00 or before, and walked against the context's clip (`2abe`, `2b62`): 101h where any of it is in, nought where none.

## Implementation

In both engines as read out; the caller is the module whose code segment called. [[probe:gdimisc]] agrees in both.

---
kind: function
module: GDI
name: RectInRegion_Ehh
ordinal: 466
summary: RectInRegion without its handle checked: whether any of a rectangle lies in a region.
versions:
  '3.1': exact
probes: [gdimisc]
records: [ehh]
topics: [regions]
---

## Observed behaviour

- [[measured]] The same answers as [[fn:GDI.RectInRegion]], 257 or nought ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `2aab` is `RectInRegion`'s body; `RectInRegion` (seg1 `4ce6`) checks its handle and jumps there. The rectangle is put in order, moved on a pixel at the right and bottom for a caller made for Windows 3.00 or before, and walked against the region (`2b62`, `2c7c`): 101h where any of it is in -- 1 in AL, and AH from the walk's mode word 183h.

## Implementation

As [[fn:GDI.RectInRegion]]. [[probe:gdimisc]] agrees in both.

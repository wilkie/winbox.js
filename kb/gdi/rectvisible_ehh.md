---
kind: function
module: GDI
name: RectVisible_Ehh
ordinal: 465
summary: RectVisible without its handle checked: whether any of a rectangle lies where the device context draws.
versions:
  '3.1': exact
probes: [gdimisc]
records: [ehh]
topics: [clip-regions]
---

## Observed behaviour

- [[measured]] The same answers as [[fn:GDI.RectVisible]], 257 where visible ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `29b7` is `RectVisible`'s body; `RectVisible` (seg1 `4d06`) checks its handle and jumps there. The rectangle is mapped to the device (`5356`), put in order, its right and bottom moved on a pixel where the caller's module was made for Windows 3.00 or before (`GetExpWinVer` of the caller's code segment), and walked against the context's clip (`2abe`): 101h where any of it is in.

## Implementation

In both engines as [[fn:GDI.RectVisible]]. [[probe:gdimisc]] agrees in both.

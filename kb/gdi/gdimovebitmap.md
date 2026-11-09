---
kind: function
module: GDI
name: GDIMoveBitmap
ordinal: 401
summary: Lets a bitmap's bits move: wires and unwires their block; answers GlobalUnWire's answer.
versions:
  '3.1': exact
probes: [gdimisc]
records: [movebitmap]
topics: [gdi-objects]
---

## Observed behaviour

- [[measured]] -1 for a bitmap ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg2 `0403`: `GlobalWire` and then `GlobalUnWire` of the block the bitmap's header names at +0Ah; `GlobalUnWire`'s answer, -1 once the count is back to nought.

## Implementation

In WinBox: -1. WinBox's bitmaps keep their bits in no global block, so there is none to wire. [[probe:gdimisc]] agrees in both.

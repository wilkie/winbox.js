---
kind: function
module: GDI
name: IsDCDirty
ordinal: 169
summary: Answers whether anything has been drawn in a device context since Windows' bounds were last cleared, and where; and clears them.
versions:
  '3.1': exact
probes: [bounds]
topics: [drawing-bounds]
---

## Observed behaviour

- [[measured]] A memory context drawn in since it was made answers 1 and the union of everything drawn, in the screen's coordinates and unclipped: -10, -20 to 32767, 220 after a rectangle half off its bitmap, text and a rectangle past its end ([[probe:bounds]]).
- [[measured]] Asked again at once, it answers nought and writes a rectangle of noughts: it clears them.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `4352`: -1 for a handle of nought; 1 and Windows' rectangle (BCh) where their set flag is, nought and four noughts where not; then `SetDCStatus(hdc, 0, NULL)`.

## Implementation

In both engines as read out. [[probe:bounds]] agrees in both.

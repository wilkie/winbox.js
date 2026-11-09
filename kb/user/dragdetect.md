---
kind: function
module: USER
name: DragDetect
ordinal: 465
summary: Whether the mouse, pressed at a point, is dragged from it.
versions:
  '3.1': exact
probes: [userint]
records: [dragdetect]
topics: [mouse-input]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:userint]] posts a mouse move and the left button's release, both where the cursor is, and asks from points beside it: 1 where the cursor is three pixels or more to the left of the point, or two or more below it; nought where the release comes first. Capture is let go after.

## Inside Windows

- [[read out]] `USER.EXE` seg14 `035e`-`03ec`: the window given the capture; a rectangle of the point grown by twice `[6A0h]` and `[6B4h]` -- `SM_CXBORDER` and `SM_CYBORDER` (seg3 `191b`-`192a`); the mouse's messages taken with `PeekMessage`, waiting with `WaitMessage` for none, until a move whose point is outside the rectangle, 1, or the left button up, nought; capture released.

## Implementation

`crates/winbox-win16/src/small_calls.rs`.

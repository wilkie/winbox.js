---
kind: function
module: GDI
name: FastWindowFrame
ordinal: 400
summary: Draws a rectangle's frame in one call through the display driver's FastBorder where it can, answering −1; nought otherwise.
versions:
  '3.1': exact
probes: [visfam]
records: [frame]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] On a window's context, a frame of (10, 10, 110, 60) 4 across and 3 down with `PATINVERT` answers −1 and inverts the four sides, the corners once ([[probe:visfam]], `frame`).
- [[measured]] With a corner cut out of the visible region by [[fn:GDI.ExcludeVisRect]], it answers nought and draws nothing; on a memory context, nought.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `420e`: nought for a memory context (the flag at 0Ah) and for a driver without `RC_GDI20_OUTPUT` (`422e`-`423c`), and where the region drawing goes through is not one rectangle (`4243`-`424c`); else the rectangle taken into the bounds, mapped to the device (`427d`), and the driver's `FastBorder` called (its table's entry at 40h) with the clip box, the brush and the operation. `VGA.DRV`'s (seg1 `2532`) draws each side kept to the clip box and answers −1 (`280f`). USER draws a window's sizing frame with it, another way where it answers nought (`USER.EXE` seg1 `8d74`-`8d7d`; [[topic:visible-regions]]).

## Implementation

In both engines (`src/win16/gdi/visible-region.ts`, `crates/winbox-win16/src/gdi/visible_region.rs`): on a display's context whose clip region within the visible region is one rectangle, four `PatBlt`s in the device's terms -- top and bottom the whole width, the sides between -- and −1; nought otherwise. [[probe:visfam]]'s `frame` agrees in both.

---
kind: function
module: GDI
name: OffsetVisRgn
ordinal: 102
summary: Moves a device context's visible region, and answers the kind drawing is kept to.
versions:
  '3.1': partial
probes: [visfam]
source: src/win16/gdi/visible-region.ts
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] By (-30, -20) on a window's context at (100, 100) it answers 2; the visible region is (70, 80, 270, 180) and the clip box (-30, -20, 170, 80); drawing lands in the whole of the moved region, outside the client area too ([[probe:visfam]], `offset`).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `2929`: the region at A0h moved (`296c`), the saved levels marked (`18f8`), the region drawing goes through made again and its kind answered (`17b1`). See [[topic:visible-regions]].

## Implementation

In both engines (`src/win16/gdi/visible-region.ts`, `crates/winbox-win16/src/gdi/visible_region.rs`): the visible region moved, the kind answered. A window's context is a view of the whole screen from its origin and draws through its region alone, so it draws where the moved region reaches, outside the window too; [[probe:visfam]]'s `offset` agrees in both.

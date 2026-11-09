---
kind: function
module: GDI
name: IntersectVisRect
ordinal: 98
summary: Keeps a device context's visible region inside a rectangle given in the screen's terms, and answers the kind drawing is kept to.
versions:
  '3.1': exact
probes: [visfam]
records: [intersect]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] (150, 120, 250, 170) on a window's context at (100, 100) answers 2; the visible region is that rectangle, the clip box (50, 20, 150, 70), and drawing lands only within it ([[probe:visfam]], `intersect`).
- [[measured]] The wrong way round, (250, 170, 150, 120), leaves nothing and answers 1.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `16a2` shares its body with [[fn:GDI.IntersectClipRect]] (`16b9`), told apart by the field changed, A0h rather than 0Eh: the rectangle is **in the screen's terms and not mapped**. Menus keep an item's drawing inside the bar with it ([[topic:visible-regions]]).

## Implementation

In both engines (`crates/winbox-win16/src/gdi/visible_region.rs`): the visible region intersected with the rectangle as given, edges not put in order; the kind of the clip region within it answered. [[probe:visfam]]'s `intersect` agrees in both.

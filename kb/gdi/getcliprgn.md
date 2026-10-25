---
kind: function
module: GDI
name: GetClipRgn
ordinal: 173
summary: Answers the handle of a device context's own clip region, in screen coordinates, or nought where it has none.
versions:
  '3.1': exact
probes: [dcinner]
topics: [device-context-internals, clip-regions]
---

## Observed behaviour

- [[measured]] A new device context, memory or a window's, answers nought ([[probe:dcinner]]).
- [[measured]] After [[fn:GDI.SelectClipRgn]] it answers a region of the context's own, not the one selected, with the same box; [[fn:GDI.OffsetClipRgn]] moves it. `SelectClipRgn` of nought takes it away again.
- [[measured]] [[fn:GDI.IntersectClipRect]] and [[fn:GDI.ExcludeClipRect]] make one where there was none: on a new memory context, whose bitmap is one pixel, an empty one.
- [[measured]] The region is in the screen's coordinates: on a window's context, a rectangle of 5,5 to 60,50 is 19,38 to 74,83 for a client area at 14,33.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `5130` hands offset 0Eh to seg1 `5162`, which answers the dword there: the clip region's handle, and a field of the device's above it.

## Implementation

In both engines, the clip region, moved by the context's origin on the screen, as a region object the context keeps and refreshes each time it is asked; nought where there is none. A program changing that region does not change the clip region, as it would in Windows. [[probe:dcinner]] agrees in both.

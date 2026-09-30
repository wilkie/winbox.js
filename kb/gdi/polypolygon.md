---
kind: function
module: GDI
name: PolyPolygon
ordinal: 450
summary: Draws several polygons filled together under the fill mode — on Windows 3.1 without closing any of them, outline or fill.
versions:
  '3.1': exact
probes: [gdidraw]
source: src/win16/gdi/gdi-draw.ts
---

## Observed behaviour

[[probe:gdidraw]] draws two overlapping triangles and a square with a square hole with the light grey brush and the black pen, under each fill mode. [[measured]]

- **No ring is closed.** Each is outlined through its points in order, and not back to its first: the triangles have no third side and the squares no left side.
- **The fill uses the same open edges.** Under `ALTERNATE`, a row is filled between pairs of the edges it crosses. On row 10, the crossings at 10, 20 and 30 fill from 10 to 20, and the last is left over. Under `WINDING`, it is filled between any two crossings where the count of edges crossed so far, one way less the other, is not nought, which leaves no row with an end open.
- It answers TRUE.

A program that wants its polygons closed repeats each one's first point at its end. [[fn:GDI.Polygon]] closes its one polygon itself.

winbox.js agrees with all of these records. It was a stub. Its winding fill now fills between crossings as above, which is the same as before for closed polygons.

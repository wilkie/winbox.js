---
kind: function
module: GDI
name: Polygon
ordinal: 36
summary: Fills a closed shape given as a list of points with the selected brush, then draws its outline with the selected pen.
versions:
  '3.1': exact
probes: [polyfill]
source: src/win16/gdi/Polygon.ts
topics: [polygon-fill, line-drawing, display-drivers]
---

## Observed behaviour

- [[documented]] The call takes a device context, a far pointer to an array of `POINT`s, and a count. The shape closes itself: the last point joins back to the first. The brush fills the inside, and the pen draws the edges.
- [[read out]] A VGA reports `POLYGONALCAPS` 8, scanlines only, so GDI turns the fill into scanlines itself. The fill is half-open: a row's run stops one pixel short of its right edge, and an edge stops one row short of its lower end. See [[topic:polygon-fill]].
- [[measured]] [[probe:polyfill]] fills 117 quadrilaterals with a null pen, once in each fill mode. Its sample includes rectangles turned every five degrees, bands two and three pixels thick, and the corners of turned text grounds. winbox.js reproduces all 234 fills. The two fill modes give the same ink for every one of these convex shapes.
- [[measured]] The outline is each edge drawn the way [[fn:GDI.LineTo]] draws a line, with the last edge going back to the first point. Each vertex is drawn as the start of the edge that leaves it. The same probe draws all 117 shapes with a black pen, once over a null brush and once over a black brush. winbox.js reproduces all 234.
- [[measured]] The outline is not inside the fill. Across the 117 outlines, 3,602 of the 6,970 pixels lie where the fill leaves the page white, and every outline has some. With both a pen and a brush, the ink is exactly the fill and the outline added together, in all 117 records.

## Nuances

- Recorded on a VGA only. Not yet measured: the other displays, a shape that is not convex (where the fill mode decides what is inside), shapes that cross the bitmap's edge, wide or styled pens, and the return value.

## Implementation

`Polygon` reads the points as signed words. It fills with `Surface.fillPolygon` when the brush is not null, then draws each edge with `Surface.drawLine`, the call [[fn:GDI.LineTo]] uses, when the pen is not null. Before this, `Polygon` was a stub. The fill happens only on pixels winbox.js owns, such as a memory bitmap, and a browser canvas gets the outline alone. `SetPolyFillMode` and `Polyline` are still stubs, so the fill mode has no effect. The derivation is in [[fonts:8u]].

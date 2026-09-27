---
kind: topic
name: Regions
summary: How GDI makes regions from rectangles, ellipses, rounded rectangles and polygons, combines them, answers questions about them and paints them — recorded pixel for pixel on a monochrome bitmap, including a GDI bug that leaves most poly-polygon regions unmade.
probes: [regions]
---

A region is a set of pixels. GDI keeps one as bands of rows, each band a list of runs of columns. [[probe:regions]] makes regions, combines them and paints them into a 64-by-64 monochrome bitmap, then reads back every pixel. 65 of its 66 records agree with winbox.js. The last is a GDI bug, described below.

## Kinds

Every call that makes or changes a region answers its kind: 1 for an empty region (`NULLREGION`), 2 for a single rectangle (`SIMPLEREGION`), 3 for anything else (`COMPLEXREGION`), and nought for an error. [[measured]] The kind depends only on the pixels, not on how the region was made. Two rectangles that meet along an edge combine into one rectangle, kind 2.

## Making regions

- [[measured]] [[fn:GDI.CreateRectRgn]] given a rectangle the wrong way round, `24,24,4,4`, makes an empty region. It does not turn it round.
- [[measured]] [[fn:GDI.CreateEllipticRgn]] holds the pixels [[fn:GDI.Ellipse]] fills with no pen, and every ellipse in the probe agrees pixel for pixel ([[topic:ellipses]]). The right and bottom edges are outside: `0,0,20,14` has the box `0,0,19,13`. A rectangle the wrong way round is turned. One that would hold no pixel, such as `10,10,11,11`, makes no region at all.
- [[measured]] [[fn:GDI.CreateRoundRectRgn]] is the rounded rectangle's fill in the same way. [[read out]] A corner nought across or nought down makes a plain rectangle's region, with the right and bottom edges where they were given (`GDI.EXE` seg9 `01cb`).
- [[measured]] [[fn:GDI.CreatePolygonRgn]] holds the rows the polygon's fill covers ([[topic:polygon-fill]]), by `ALTERNATE` or `WINDING`. The five-pointed star fills differently by the two: `ALTERNATE` leaves its middle out, and `WINDING` fills it.
- [[read out]] Fewer than two points answer **1**, which is no region's handle. More than 3FFDh answer nought. A last point that repeats the first is dropped (seg24 `0254`). [[measured]] Two points make no region.

## A bug in poly-polygon regions

[[read out]] [[fn:GDI.CreatePolyPolygonRgn]] adds up the polygons' points, then gives its polygon builder the **number of polygons** in the place where the number of points belongs (seg24 `02e5`).

- [[measured]] So one polygon or two make no region: the builder is asked for a polygon of one or two points.
- [[measured]] Three triangles make a parallelogram between the second edges of the first two.
- winbox.js answers nought for one or two polygons, and makes the union for three or more. That last record is a known gap.

## Combining

[[fn:GDI.CombineRgn]] makes its first region from the other two:
- `RGN_AND` keeps the pixels in both.
- `RGN_OR` keeps the pixels in either.
- `RGN_XOR` keeps the pixels in one only.
- `RGN_DIFF` keeps the first less the second.
- `RGN_COPY` copies the first.

[[measured]] The probe combines a rectangle with six others (overlapping, apart, the same, empty, inside, touching) in every mode, and records each answer, box and pixel.

- [[measured]] A rectangle inside another, with `RGN_XOR` or `RGN_DIFF`, is a rectangle with a hole: kind 3.
- [[measured]] Mode 0 is taken as `RGN_DIFF` and mode 6 as `RGN_COPY`.

## Asking

- [[measured]] [[fn:GDI.GetRgnBox]] answers the kind, and the box is all nought for an empty region.
- [[measured]] [[fn:GDI.PtInRegion]] counts the right and bottom edges as outside, as every rectangle does.
- [[measured]] [[fn:GDI.RectInRegion]] answers **101h** when any of the rectangle is in the region. A rectangle given the wrong way round is turned.
- [[measured]] [[fn:GDI.EqualRgn]] compares pixels.
- [[measured]] [[fn:GDI.OffsetRgn]] answers the kind.
- [[measured]] [[fn:GDI.SetRectRgn]] with an empty rectangle makes an empty region.

## Painting

- [[measured]] [[fn:GDI.FillRgn]] fills with a brush as `PatBlt` does. The grey stock brush dithers on a monochrome bitmap ([[topic:brush-dithering]]). [[fn:GDI.PaintRgn]] uses the device context's own brush, and [[fn:GDI.InvertRgn]] turns every pixel.
- [[measured]] [[fn:GDI.FrameRgn]] draws a frame `nWidth` across and `nHeight` down, inside the region's edge. A pixel is part of the frame when the region does not also hold the pixel that far away from it, straight or diagonally. So a hole's corner gets a diagonal pixel of frame.

## In winbox.js

`src/win16/gdi/regions.ts` makes and uses regions. A region's pixels are a `ClipRegion` (`src/raster/clip-region.ts`), the same banded form clipping uses, so `SelectClipRgn` takes any region's shape. `FillRect` is now what USER makes it: the brush selected and `PatBlt` with `PATCOPY`, so it dithers as `PatBlt` does.

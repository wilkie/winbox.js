---
kind: function
module: GDI
name: Polyline
ordinal: 37
summary: Draws a chain of lines through a list of points with the selected pen, leaving the current position where it was.
versions:
  '3.1': exact
probes: [polyline]
source: src/win16/gdi/Polyline.ts
topics: [line-drawing]
---

## Observed behaviour

[[measured]] [[probe:polyline]] draws chains on a 32-pixel monochrome bitmap with the stock black pen, in `R2_COPYPEN` and in `R2_NOT`, and records the whole cell, the answer, and the current position after.

- It draws what a [[fn:GDI.MoveTo]] to the first point and a [[fn:GDI.LineTo]] to each point after it would draw. Each line leaves out the pixel it stops on, so the last point is not drawn. Each point between is drawn once, as the start of the next line.
- A closed chain, its last point the first, draws that point once.
- Where a chain turns back over itself, the pixels are drawn twice. In `R2_NOT` the second drawing takes them out again: 4,10 to 26,10 and back to 10,10 leaves 4 to 10 and 26.
- The current position is left where it was. It does not move to the first point or the last.
- One point, or none, answers 0 and draws nothing. Two points the same answer 1 and draw nothing.
- Under a mapping mode the points are mapped as `LineTo`'s are.

winbox.js agrees with all 27 records.

## Found on the way

- Lines ignored the drawing mode. [[fn:GDI.SetROP2]] was kept and never used, so a line in `R2_NOT` drew in the pen's colour. Only a chain that crossed itself could show the difference on white. Lines now combine each pixel with what is there, as [[fn:GDI.Ellipse]] already did.

## Nuances

- Not measured: pens wider than one pixel, where the joins between lines matter, and styled pens.

## Implementation

`Polyline` reads the points and calls `LineTo` for each, then puts the current position back. `LineTo` draws in a drawing mode other than `R2_COPYPEN` by gathering the walk's pixels from `BitmapContext.stroke` and combining each with the pen's colour, through the same raster-operation engine as [[fn:GDI.PatBlt]].

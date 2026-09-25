---
kind: function
module: GDI
name: Ellipse
ordinal: 24
summary: Draws an ellipse inside a rectangle, its outline in the selected pen and its inside in the selected brush.
versions:
  '3.1': exact
probes: [curves]
source: src/win16/gdi/Ellipse.ts
topics: [ellipses, polygon-fill, non-square-pixels]
---

## Observed behaviour

- [[documented]] The call takes a device context and a rectangle. The ellipse fits inside it.
- [[read out]] The right and bottom of the rectangle are outside the ellipse. GDI takes a pixel off each, makes the ellipse's points with its own curve walk, and fills them as a polygon. See [[topic:ellipses]].
- [[measured]] [[probe:curves]] draws fourteen ellipses on four displays: every size from one to eight pixels square, forty by twenty-four, twenty-seven by thirty-three, and thirty-six by two. They are drawn with a pen one pixel wide, three wide and none, with and without a brush. winbox.js reproduces every pixel.
- [[measured]] An ellipse one pixel square draws nothing. One two pixels square is a square of four pixels.
- [[read out]] A pen wider than a pixel draws a ring outside the brush. Its height is the width scaled by the display's aspect: two pixels for a three-pixel pen on the EGA and the Hercules.

## Nuances

- Not yet measured: pens other than solid, `PS_INSIDEFRAME`, mapping modes, and the return value.

## Implementation

`Ellipse` and [[fn:GDI.RoundRect]] share `paintShape` in `src/win16/gdi/Ellipse.ts`. It works out the pen's size, has `shapeOf` in `src/raster/curves.ts` make the shape, paints the brush's rows as a `PatBlt` would, and sets the pen's pixels in its colour. Before this, `Ellipse` was a stub.

---
kind: function
module: GDI
name: RoundRect
ordinal: 28
summary: Draws a rectangle with rounded corners, each a quarter of an ellipse of the given size, its outline in the selected pen and its inside in the selected brush.
versions:
  '3.1': exact
probes: [curves]
source: src/win16/gdi/RoundRect.ts
topics: [ellipses, polygon-fill]
---

## Observed behaviour

- [[documented]] The call takes a device context, a rectangle, and the width and height of the ellipse the corners are cut from.
- [[read out]] The corner's radius is half its size, rounded down. That is one pixel larger than an [[fn:GDI.Ellipse]] of the same size. The corner is no larger than the rectangle. See [[topic:ellipses]].
- [[measured]] [[probe:curves]] draws eleven rounded rectangles on four displays. Their corners run from nought, through sizes that are odd, flat and tall, to larger than the rectangle. They are drawn with a pen one pixel wide, three wide and none, with and without a brush. winbox.js reproduces every pixel.
- [[measured]] A corner of nought draws a plain rectangle. [[read out]] GDI hands it to `Rectangle`.
- Calculator draws its keys with it.

## Nuances

- Not yet measured: pens other than solid, `PS_INSIDEFRAME`, a wide pen whose inner corner has nothing left, mapping modes, and the return value.

## Implementation

See [[fn:GDI.Ellipse]], whose `paintShape` this shares. Before this, `RoundRect` was a stub.

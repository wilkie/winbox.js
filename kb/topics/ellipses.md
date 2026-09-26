---
kind: topic
name: Ellipses and rounded rectangles
summary: How GDI makes an ellipse or a rounded rectangle into a list of points and fills it as a polygon — its own curve walk, the corner's size, and how a wide pen becomes a ring — read out of GDI.EXE and measured on four displays.
probes: [curves, mixmode]
---

[[fn:GDI.Ellipse]] and [[fn:GDI.RoundRect]] share one body in `GDI.EXE`, seg9 `02c4`. The display driver is offered the shape first. None of the four drivers recorded takes it, so GDI draws it: it turns the shape into a list of points and fills that as a polygon, by the walk in [[topic:polygon-fill]]. [[measured]] [[probe:curves]] draws 25 shapes on the VGA, Super VGA, EGA and Hercules and reads back every pixel. They are fourteen ellipses and eleven rounded rectangles, from one pixel square to forty by thirty, with a pen one pixel wide, three wide and none, over a light grey brush and none. winbox.js agrees with every pixel on all four displays.

## The curve

- [[read out]] GDI first takes one pixel off the right and bottom, so the shape is inside the rectangle's right and bottom edges. The centre is half-way between the left and the new right, rounded down. When that halving loses a pixel, the right-hand quarters stand one pixel further right; so for the bottom (seg9 `0b7e`).
- [[read out]] GDI makes one quarter and turns it into the other three. The quarter is its own walk (seg9 `1175`), in whole numbers throughout. It starts at the end of the longer axis and steps along the shorter while the curve is steeper than a diagonal, then along the longer. A tall ellipse is walked on its side and turned back (`08fa`, `113e`).
- [[read out]] In the walk's second half, a point on the column it last stood on is passed over whenever its error term says to step both ways. [[measured]] For a circle of radius four this leaves out the point (3, 3), which the textbook midpoint walk draws. The textbook walk fits every ellipse [[probe:curves]] draws, and misses only that corner of the eight-by-eight rounded rectangle.
- [[read out]] A radius of nought on either axis makes the shape a rectangle of four points (`0a97`). [[measured]] An ellipse one pixel square is drawn not at all: its four points are one point, and neither the fill nor the pen has anything to draw.
- [[refused]] Walking the quarter from both ends, to meet at the diagonal, also leaves out (3, 3), but misses 66 pixels elsewhere on the VGA.

## The corner

- [[read out]] `RoundRect`'s corner is the quarters of an ellipse the corner's size, counted inclusively. It is no larger than the rectangle less a pixel (seg9 `0405`), and the straight sides stand between the quarters. Its radius is half the corner's size, where an ellipse the same size has half of one less. [[measured]] A corner of 8 by 8 is a circle of radius four, where `Ellipse` 8 by 8 draws radius three and a half.
- [[measured]] A corner of nought draws a rectangle. [[read out]] GDI hands a corner of nought to `Rectangle`'s own body (seg25 `0056`). Through the curve it would be a corner of one pixel, radius nought, which is the same rectangle.

## The pen and the brush

- [[read out]] A pen no wider than a pixel draws the points as [[fn:GDI.Polygon]] would. The brush fills them with `ALTERNATE`, and the pen draws each edge as [[fn:GDI.LineTo]] does. It is not a separate path.
- [[measured]] With no pen, the brush fills the same polygon, so the shape's right and bottom pixels are left white.
- [[read out]] A wider pen is drawn as two polygons (seg21 `14b7`):
  - The **inner** shape is the rectangle less the pen's larger half on the left and top and its smaller half on the right and bottom. The brush fills it.
  - The **outer** shape is the inner grown by the whole pen. The two lists together are filled with a solid brush of the pen's colour. Since `ALTERNATE` counts crossings, that fill is the ring between them.
  - A rounded corner shrinks and grows with the shape. [[measured]] The corners that fit the three-pixel pen's rounded rectangle are one of a family of sixteen, and the code picks this one.
- [[read out]] The pen's height is fixed when the pen is realised (seg1 `2751`): its width through `MulDiv` by the display's `ASPECTX` over `ASPECTY`, rounded to nearest. [[measured]] A three-pixel pen is two pixels tall on the EGA (3 × 38 / 48) and on the Hercules (3 × 11 / 16), three on the VGA and Super VGA. See [[topic:non-square-pixels]].
- [[measured]] On the EGA and the Hercules the light grey brush is a dither pattern, and it lines up with the screen, as a `PatBlt` does. See [[topic:brush-dithering]].

## Drawing modes

- [[measured]] Under a drawing mode other than `R2_COPYPEN`, the brush mixes with the pixels first and the pen after. [[probe:mixmode]] draws a rounded rectangle and an ellipse in each of the sixteen modes over stripes of four colours, on four displays, and winbox.js agrees with every pixel. See [[fn:GDI.SetROP2]].
- [[measured]] With a one-pixel pen, the fill also covers the outline's left and top, so a mode like `R2_NOT` applies twice there and leaves those pixels as they were. Calculator shows a key pressed by drawing it over itself with `R2_NOT`, which inverts the inside and leaves the left and top edges black, then draws it once more to put it back.

## Not yet done

- Pens other than solid. `PS_INSIDEFRAME`, whose inner shape is the rectangle less the whole pen.
- A wide pen whose inner corner has nothing left, for which GDI draws a rectangle and a `PatBlt` of its own.
- `Arc`, `Chord` and `Pie`, and the return values.

## In winbox.js

- `src/raster/curves.ts` makes the points and the shapes.
- `src/raster/polygon.ts` is the polygon walk that `Surface.fillPolygon` also uses.
- `src/win16/gdi/Ellipse.ts` has the pen's size and draws the result: the brush as a `PatBlt`, the pen in its colour.

Calculator draws its keys with `RoundRect`.

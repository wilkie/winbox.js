---
kind: topic
name: Ellipses and rounded rectangles
summary: How GDI makes an ellipse or a rounded rectangle into a list of points and fills it as a polygon — its own curve walk, the corner's size, and how a wide pen becomes a ring — read out of GDI.EXE and measured on four displays.
probes: [curves, mixmode, wedges, inframe]
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

## An inside-frame pen

[[measured]] [[probe:inframe]] draws 28 shapes with a `PS_INSIDEFRAME` pen 2 to 7 pixels wide on the VGA. They are ellipses round and flat, rounded rectangles with an even and an uneven corner, pies, chords and rectangles, in black and in a colour the display lacks. winbox.js agrees with every pixel.

- [[read out]] An ellipse or a rounded rectangle goes through the same two polygons as any wide pen (seg21 `14b7`), with two differences for this style:
  - The **inner** shape is the rectangle less the whole pen on every side, not half of it. The **outer** shape grows that back by the whole pen, so it is the rectangle's own.
  - Both lists are moved before they are filled (seg21 `1349`), so that the fill takes in the right and bottom edges it otherwise leaves out. [[measured]] So the frame's outside is the shape exactly as a thin pen draws it, and the brush inside is the thin shape of the rectangle less the pen.
- [[read out]] The move goes round the list from the right. The points up the right side move a pixel right, the top and left side stay, and the bottom moves a pixel down. Where the bottom meets the sides, two points are doubled and moved both ways. [[measured]] Run on winbox.js's processor, GDI's own routine makes the same list as winbox.js for every ellipse from 1 to 40 pixels by 1 to 30: 1,131 of 1,131. A list that does not start at the right, such as a pie's, would run it past its end. Pies do not come this way.
- [[measured]] A rounded rectangle's inner corner is its corner less twice the pen.
- [[measured]] [[fn:GDI.Pie]] and [[fn:GDI.Chord]] keep the frame inside another way, as [[fn:GDI.Rectangle]] does. The rectangle loses half the pen, rounded down, on every side, and the shape in it is drawn as any wide pen draws it.
- [[read out]] Any other wide pen's ring is filled with a solid brush of the colour the display draws the pen as. This style skips that step, so its ring is filled with a brush of the pen's own colour. [[measured]] Red 128, green 64, blue 192 frames every one of these shapes in a pattern of dark grey, blue and magenta. The same pen a pixel wide, and a `PS_SOLID` pen four wide, are solid blue. See [[topic:brush-dithering]].

## Drawing modes

- [[measured]] Under a drawing mode other than `R2_COPYPEN`, the brush mixes with the pixels first and the pen after. [[probe:mixmode]] draws a rounded rectangle and an ellipse in each of the sixteen modes over stripes of four colours, on four displays, and winbox.js agrees with every pixel. See [[fn:GDI.SetROP2]].
- [[measured]] With a one-pixel pen, the fill also covers the outline's left and top, so a mode like `R2_NOT` applies twice there and leaves those pixels as they were. Calculator shows a key pressed by drawing it over itself with `R2_NOT`, which inverts the inside and leaves the left and top edges black, then draws it once more to put it back.

## Arcs, chords and pies

[[fn:GDI.Arc]], [[fn:GDI.Chord]] and [[fn:GDI.Pie]] go through the same body, seg9 `02c4`, with a flag each. They draw the part of the ellipse between two radials, from the centre through the first point and round anticlockwise to the second. [[measured]] [[probe:wedges]] draws 21 of them on the VGA: quarters, halves, three quarters, a thin slice, a start the same as its end, radials to points far outside, a flat ellipse, no pen and no brush. winbox.js agrees with every one of its 693 records.

- [[read out]] GDI's list of the ellipse's points holds only the points where its outline turns (seg9 `08fa`). A straight run of each quarter is one edge, and a point two quarters share is there once. The list starts at the right on the centre's row and runs anticlockwise on the screen: up, left, down, and back. The fill cannot tell this order from any other, so it had never been needed before.
- [[read out]] Each radial is found among the edges (`082b`). The search takes the first point anticlockwise of the ray, stepping an eighth of the list at a time (rounded to a power of two) and then halving. Anticlockwise is the sign of a cross product with y upwards (`0750`).
- [[read out]] The edge into the start's point is walked a pixel at a time until it crosses the ray. The edge out of the end's point is walked back until it has not. Of the two pixels either side of the ray, the one past it is kept unless the other is strictly nearer the radial's own point (`0794`).
- [[read out]] When both radials cross one edge, GDI gives them two points of their own there. It takes the short way between them when the start is clockwise of the end, and the long way round the ellipse when it is not. So a start the same as its end draws the whole ellipse, and [[fn:GDI.Pie]] adds its radial.
- [[read out]] The list is turned so that it starts at the start, and kept up to the end. `Pie` adds the centre. `Arc` draws the points as a polyline, the last point left off. `Chord` and `Pie` fill theirs with the brush and draw every edge with the pen, as [[fn:GDI.Polygon]] does.
- [[read out]] A start and end that the mapping makes one point, though they were two, are taken as the whole ellipse when the start is anticlockwise of the end. `Arc` then draws nothing (`0360`).
- [[measured]] Every point list winbox.js makes was checked against GDI's own code, seg9 `0b7e` run on winbox.js's processor, with its one outside call, a 32-bit multiply, answered by a few instructions of its own. The lists agreed for every ellipse from 1 to 40 pixels each way, and for 4,000 random arcs, chords and pies.

## Not yet done

- Pens other than solid.
- A wide pen whose inner corner has nothing left, for which GDI draws a rectangle and a `PatBlt` of its own.
- The return values.
- A `PS_INSIDEFRAME` pen on an `Arc`, and under mapping modes.

## In winbox.js

- `src/raster/curves.ts` makes the points and the shapes.
- `src/raster/wedges.ts` makes the ellipse's turning points and cuts them, and `src/win16/gdi/wedges.ts` draws them.
- `src/raster/polygon.ts` is the polygon walk that `Surface.fillPolygon` also uses.
- `src/win16/gdi/Ellipse.ts` has the pen's size and draws the result: the brush as a `PatBlt`, the pen in its colour.

Calculator draws its keys with `RoundRect`.

---
kind: function
module: GDI
name: Pie
ordinal: 26
summary: Draws the wedge of an ellipse between two radials, filled with the brush and outlined with the pen.
versions:
  '3.1': exact
probes: [wedges, widepoly, inframe]
source: src/win16/gdi/wedges.ts
topics: [ellipses, polygon-fill]
---

## Observed behaviour

- [[read out]] `Pie` is the ellipse in its rectangle, cut at the radials from the centre through its two points, anticlockwise from the first to the second, with the centre added. [[fn:GDI.Chord]] is the same without the centre, and [[fn:GDI.Arc]] is the curve alone, drawn as a polyline. The construction, read out of `GDI.EXE` seg9, is in [[topic:ellipses]].
- [[measured]] [[probe:wedges]] draws nine pies, six chords and six arcs on the VGA, and winbox.js agrees with every pixel. The cases are quarters, halves, three quarters, a thin slice, a start the same as its end (the whole ellipse, with its radial), radials to points far outside, a flat ellipse, no pen and no brush.
- [[measured]] Tetris for Windows of the corpus draws with `Pie`.

- [[measured]] With a pen wider than a pixel, the outline back to the first point is swept by the pen, as [[topic:line-drawing]] describes. [[probe:widepoly]] records a pie with pens 3 and 6 wide.
- [[measured]] A `PS_INSIDEFRAME` pen wider than a pixel draws the pie in the rectangle less half the pen, rounded down, on every side. In a colour the display lacks it is a pattern, where a `PS_SOLID` pen is one colour. [[probe:inframe]] draws five such pies and two chords.

---
kind: function
module: GDI
name: LineTo
ordinal: 19
summary: Draws a line with the selected pen from the current position to a point, and makes that point the new current position.
versions:
  '3.1': exact
probes: [lines]
topics: [line-drawing, display-drivers]
---

## Observed behaviour

- [[documented]] The line runs from the current position to the given point, which then becomes the current position. The return value is non-zero when the line was drawn.
- [[measured]] Every pixel is the one nearest the true line, and the pixel at the end point is left out. [[probe:lines]] drew 2,478 lines with a one-pixel black pen on a monochrome bitmap, on each of four displays. Even a line ending on the bitmap's last row or column leaves its end point out, on every display. See [[fonts:3]].
- [[measured]] The display driver decides only the ties, where the line passes exactly between two pixels. The VGA, Super VGA and EGA send a tie to the smaller y. The Hercules decides by the slope in lowest terms: it disagrees with them in 192 of the 740 lines of the first sweep. See [[topic:line-drawing]] and [[fonts:8v]].
- [[measured]] A line that leaves the bitmap is drawn by the driver on the three colour displays, which report `CLIPCAPS` 1. On the Hercules, which reports 0, GDI draws it. 858 lines on each display are clipped. The colour drivers draw exactly the visible part of each whole line. On the Hercules, 187 of the 858 come out differently. See [[topic:display-drivers]].
- [[measured]] Calls one after another join up. Each segment draws its start point, so a shared point is drawn once, by the segment that leaves it. A `LineTo` to the current position draws nothing. `chain(2,9,3,7,3,7)` inks `(2,9)` and one pixel after it, but never `(3,7)`, on every display.

## Nuances

- [[measured]] Two calls in a row draw the same ink as each segment drawn alone. The eight `chain` records and eleven `poly` records agree with that on all four displays. A stroke font's glyph, handed to the driver as a single polyline, can break a tie differently. See [[topic:line-drawing]].
- Not yet measured: pens wider than one pixel, dashed and dotted pen styles, raster operations other than the default, colour bitmaps, and the return value.

## Implementation

`LineTo` draws through `Surface.drawLine`. When winbox.js owns the pixels, as on a memory bitmap, that call walks the line as recorded (`BitmapContext.stroke`). It uses the tie rule and `CLIPCAPS` of the display mode, and leaves out the last pixel. All 9,912 records of [[probe:lines]] are replayed through [[fn:GDI.MoveTo]] and this export, and all of them agree. On a browser canvas the line is the canvas's own stroke instead. That stroke is only an approximation, and nothing has recorded it against Windows. To record the lines yourself, see [[guide:reproducing]].

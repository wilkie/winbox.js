---
kind: topic
name: Line drawing
summary: Which pixels a one-pixel line in Windows 3.1 inks. The nearest pixel to the true line, the end point left out, a tie broken by the display driver, and a line that leaves the surface drawn by GDI when the driver cannot clip.
probes: [lines, plotter, polyfill]
---

A line is the simplest thing GDI draws, and its pixels still depend on the display. [[fn:GDI.MoveTo]] sets where a line starts, and [[fn:GDI.LineTo]] draws it. [[fn:GDI.Polygon]] draws its outline the same way, and the stroke fonts draw their letters from lines too. [[probe:lines]] asks the question directly. It draws with a one-pixel black pen on a 32-pixel monochrome bitmap and records the whole cell: 2,478 lines on each of four displays.

## The walk

- [[measured]] Every pixel is the one nearest the true line. For a major span `M` and a minor span `m`, step `i` moves `i * m / M` along the minor axis, rounded. The only freedom a driver has is at a tie, where the line passes exactly between two pixels. The first sweep of 740 lines on each display, 2,960 in all, has no exceptions.
- [[measured]] The pixel the line stops on is not drawn. This holds even on the bitmap's last row and last column, which a ring of radius fifteen and a fan of span thirty-one reach, on every display.
- [[measured]] Where a line begins makes no difference, only its slope. 236 slopes from four origins, on a VGA and a Hercules, do not depend on the parity of either coordinate.
- [[measured]] A chain of `LineTo` calls is each segment drawn alone. A shared point is drawn once, as the start of the next segment, and a segment of no length draws nothing. That holds for the eight `chain` and eleven `poly` records on all four displays.

## The tie belongs to the driver

- [[measured]] The VGA, Super VGA and EGA agree record for record. A tie goes to the **smaller y**, whichever way the line runs and whichever axis is the long one.
- [[measured]] The Hercules uses the slope in lowest terms, `m/M`. A tie rises when `2m > M` and falls when `2m < M`. The two end slopes, `1/M` and `(M-1)/M`, go the other way. That differs from the colour drivers in 192 of 740 lines and predicts all 740 on each display. Why the end slopes turn over is not known.
- [[refused]] A run-length slice, the shape a driver writing whole bytes might use, matches 204 of 232 records. It scores the same 204 against the VGA, so it tells the two displays apart not at all.

So line drawing is **not** device-independent, and every `lines` fixture is recorded once for each display. See [[topic:display-drivers]].

## A line that leaves the surface

[[measured]] The three colour drivers report `CLIPCAPS` 1 and clip for themselves. For each of the 858 clipped lines in the sweep, they draw exactly the visible part of the whole line. The Hercules reports 0, so GDI clips the line and walks it with its own rules, and 187 of the 858 come out differently:

- [[measured]] GDI's walk sends a tie to the **larger** y. 307 ties arise in the clipped lines, and 98 of them land on a different pixel because of this.
- [[measured]] GDI draws the pixel the line stops on when that pixel is on the edge of the major axis. Of 522 clipped lines where drawing it changes the answer, 518 follow this. A vertical line does not draw it, as two records show. On the minor axis, the stop is drawn only for a line running up: 2 such lines draw it, and 79 running down do not.
- [[measured]] Where the major coordinate starts outside the surface, the step the line enters on rounds a half **away from the start**. That one step decides eleven records. [[refused]] Rounding every entry that way instead gets 843 of the 858.
- [[refused]] A reading in which GDI re-seeds the walk at the crossing and truncates: it gets 288 of the 858, against 856 for the rules above.

## A polyline drawn in one call

[[measured]] A stroke font hands each run of its glyph to the driver as one polyline, and on the Hercules that is not always the same as a chain of `LineTo` calls. When any point of the run is negative, GDI takes the whole run. Otherwise GDI takes only the segments that leave the surface. Against the Hercules glyph sweeps that scores 6,043 of 6,046 and 1,582 of 1,584. The other three ways of deciding how much GDI takes score lower. Why one call differs from many has not been read. Every stroke cell of [[probe:plotter]] now agrees on all four displays. `Polyline` itself is still a stub, and nothing has recorded it.

## Not yet measured

Pens wider than one pixel, dashed and dotted styles, raster operations other than the default, colour bitmaps, and the values `MoveTo` and `LineTo` return.

## In winbox.js

`BitmapContext.stroke` implements the walk. It takes the display mode's tie rule (`lineTie`) and `CLIPCAPS`, and `Surface.drawLine` uses it on pixels winbox.js owns. [[fn:GDI.LineTo]] and [[fn:GDI.Polygon]]'s outline go through it, and all 9,912 records of `lines` agree when replayed through the exported `MoveTo` and `LineTo`. On a browser canvas, `drawLine` still makes the canvas's own stroke. That stroke is not the recorded walk.

The full derivation, with every reading that was refused, is in [[fonts:3]] and [[fonts:8v]]. To record a display yourself, see [[guide:reproducing]].

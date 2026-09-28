---
kind: function
module: GDI
name: MoveTo
ordinal: 20
summary: Sets the point a device context's next line starts from, without drawing anything.
versions:
  '3.1': exact
probes: [lines, minis2, updatecp]
topics: [line-drawing, display-drivers]
---

## Observed behaviour

- [[documented]] The call takes a device context and a point in logical coordinates and makes that point the current position. It draws nothing. Its return value holds the previous position, with x in the low word and y in the high word.
- [[measured]] A following [[fn:GDI.LineTo]] starts its line exactly on this point, and that first pixel is drawn. Every record of [[probe:lines]] begins with `MoveTo` and then draws with `LineTo`. That is 2,478 records on each of four displays, and in all of them the ink starts on the point given here.
- [[measured]] The point may lie outside the bitmap. The sweep's clipped lines start as far out as `(47,5)` and `(16,-6)` on a 32-pixel cell. A line from such a point is clipped, and on a display that cannot clip for itself GDI draws it by its own rules. See [[topic:line-drawing]].
- [[measured]] Where the line starts does not change how it is walked. 236 slopes were drawn from four origins, even and odd, on a VGA and a Hercules. None of them draws differently because of the parity of either coordinate. See [[fonts:3]].

- [[measured]] [[fn:GDI.GetCurrentPosition]] reads back the point this sets, x in the low word and y in the high. [[probe:minis2]] records `0,0` on a new device context, `7,9` after `MoveTo(7,9)`, and `20,3` after a `LineTo(20,3)`, which leaves the position at the line's end. winbox.js agrees with all three.

- [[measured]] Text uses the current position when the text alignment has `TA_UPDATECP`. [[probe:updatecp]] records this on a monochrome bitmap:
  - [[fn:GDI.TextOut]] and [[fn:GDI.ExtTextOut]] pass over the point they are given, and draw the text at the current position, placed there as the rest of the alignment says.
  - The position then moves right by the text's width for `TA_LEFT`, left by it for `TA_RIGHT`, and not at all for `TA_CENTER`.
  - Two `TextOut`s in a row run on, the second starting where the first ended.

  The Windows Tutorial writes its lessons this way, a `MoveTo` before each line and `TextOut` at (0,0). All 10 records agree.

## Nuances

- The previous position is recorded through [[fn:GDI.MoveToEx]], which puts it in a `POINT`. `MoveTo`'s own return is not read by any probe.
- Not yet measured: the current position under a mapping mode other than `MM_TEXT`, or on a device context other than a memory one.

## Implementation

`MoveTo` saves the point on the surface and returns the previous one packed as the API describes. A fresh surface starts at `(0,0)`. The replay of [[probe:lines]] calls this export and then [[fn:GDI.LineTo]] for each record, so every recorded line passes through it. However, nothing checks the value it returns.

---
kind: function
module: GDI
name: MoveTo
ordinal: 20
summary: Sets the point a device context's next line starts from, without drawing anything.
versions:
  '3.1': exact
probes: [lines]
topics: [line-drawing, display-drivers]
---

## Observed behaviour

- [[documented]] The call takes a device context and a point in logical coordinates and makes that point the current position. It draws nothing. Its return value holds the previous position, with x in the low word and y in the high word.
- [[measured]] A following [[fn:GDI.LineTo]] starts its line exactly on this point, and that first pixel is drawn. Every record of [[probe:lines]] begins with `MoveTo` and then draws with `LineTo`. That is 2,478 records on each of four displays, and in all of them the ink starts on the point given here.
- [[measured]] The point may lie outside the bitmap. The sweep's clipped lines start as far out as `(47,5)` and `(16,-6)` on a 32-pixel cell. A line from such a point is clipped, and on a display that cannot clip for itself GDI draws it by its own rules. See [[topic:line-drawing]].
- [[measured]] Where the line starts does not change how it is walked. 236 slopes were drawn from four origins, even and odd, on a VGA and a Hercules. None of them draws differently because of the parity of either coordinate. See [[fonts:3]].

## Nuances

- Not yet measured: the returned previous position. The probe never reads what `MoveTo` returns.
- Not yet measured: the current position under a mapping mode other than `MM_TEXT`, or on a device context other than a memory one.

## Implementation

`MoveTo` saves the point on the surface and returns the previous one packed as the API describes. A fresh surface starts at `(0,0)`. The replay of [[probe:lines]] calls this export and then [[fn:GDI.LineTo]] for each record, so every recorded line passes through it. However, nothing checks the value it returns.

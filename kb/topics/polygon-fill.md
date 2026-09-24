---
kind: topic
name: Polygon fill
summary: How GDI converts a polygon to scanlines itself on a display that only draws scanlines — the edge walk, the rounding, and the half-open spans.
probes: [polyfill, rotstyle]
---

[[read out]] A VGA reports `POLYGONALCAPS` 8, scanlines alone, so GDI converts every polygon itself. `Polygon` is `GDI.EXE` ordinal 36 at seg24 `0000`; its conversion is bracketed by the driver's `Output` begin and end at seg24 `0bcb`, sets each edge up at `0b33` and `030e`, and walks the rows.

```mermaid
flowchart LR
  A[Outline] --> B[Split into runs<br/>that only go down]
  B --> C[Set up each edge<br/>as a Bresenham]
  C --> D[Each row: sort the<br/>active edges' x]
  D --> E[Fill pairs,<br/>half-open]
  E --> F[Step each edge]
  F --> D
```

- [[read out]] An edge that is not horizontal runs from its upper point down to, but not including, its lower one.
- [[read out]] It is a Bresenham whose major axis is the longer of the two, with an error term of `2 * minor - major + bias`, where the bias is one — except for an edge whose major axis is `y` and which steps left, which gets nothing.
- [[read out]] Each row the active edges' `x` are sorted and handed to the driver in pairs, each pair half-open.
- [[read out]] Then each edge steps: a `y`-major one by one pixel if its error is positive; an `x`-major one by at least one, and on while its error stays at or below nought.

[[measured]] [[probe:polyfill]] draws 117 quadrilaterals under both fill modes — rectangles turned every five degrees, bands two and three pixels thick, and the corners of every turned ground [[probe:rotstyle]] drew — and this reproduces 234 of 234. [[refused]] Filling the pairs inclusively reproduces none.

Not implemented: the winding rule, and `094f`'s handling of two edges meeting at a vertex, which no convex quadrilateral asks. The derivation is in [[fonts:8u]].

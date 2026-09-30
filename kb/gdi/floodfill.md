---
kind: function
module: GDI
name: FloodFill
ordinal: 25
summary: Fills outward from a point with the brush, to four neighbours at a time, up to a border colour; ExtFloodFill can instead fill all of one colour.
versions:
  '3.1': exact
probes: [gdidraw]
source: src/win16/gdi/gdi-draw.ts
---

## Observed behaviour

[[probe:gdidraw]] draws a black frame with a black diagonal line across it, a pixel wide, and fills from a point inside with the light grey brush. [[measured]]

- The fill reaches a pixel's four neighbours, not its corners: it stops at the diagonal line, and what is beyond the line stays white.
- Started on the border colour itself, it fills nothing and answers nought. Otherwise it answers TRUE.
- `ExtFloodFill` with `FLOODFILLBORDER` is the same. With `FLOODFILLSURFACE` it fills the pixels of the colour given, joined to the point: red half covered by blue fills only the red.

winbox.js agrees with all of these records. Both functions were stubs.

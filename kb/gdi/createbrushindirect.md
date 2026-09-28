---
kind: function
module: GDI
name: CreateBrushIndirect
ordinal: 50
summary: Makes a brush of any style from a LOGBRUSH, and keeps the LOGBRUSH as it was given.
versions:
  '3.1': exact
probes: [brushind]
source: src/win16/gdi/CreateBrushIndirect.ts
topics: [brush-dithering, gdi-objects]
---

## Observed behaviour

[[probe:brushind]] makes a brush of each style and fills a 16 by 16 colour bitmap with [[fn:USER.FillRect]]. The device context's background is yellow and its text colour black. Championship Slots of the corpus makes its brushes this way.

- [[measured]] [[fn:GDI.GetObject]] answers 8 bytes, the `LOGBRUSH` exactly as it was given. The colour and the hatch word are kept whatever the style: a `BS_SOLID` brush given `HS_CROSS` answers `HS_CROSS`.
- [[measured]] `BS_NULL` makes a new brush, not the stock `NULL_BRUSH`, and `FillRect` with it paints nothing.
- [[measured]] `BS_HATCHED` paints its lines in the brush's colour and the rest in the device context's background colour. `FillRect` paints that background even in `TRANSPARENT` mode. Each hatch is eight by eight, from the device context's origin:

  | Hatch            | Its line                              |
  | ---------------- | ------------------------------------- |
  | `HS_HORIZONTAL`  | the fifth row                         |
  | `HS_VERTICAL`    | the fifth column                      |
  | `HS_FDIAGONAL`   | from the top left corner, down right  |
  | `HS_BDIAGONAL`   | from the top right corner, down left  |
  | `HS_CROSS`       | the fifth row and the fifth column    |
  | `HS_DIAGCROSS`   | both diagonals                        |

- [[measured]] A hatch past `HS_DIAGCROSS` paints solid in the brush's colour. So does a style past those there are (9 was tried): it is still made, and `GetObject` answers it as given.
- [[measured]] `BS_PATTERN` takes the bitmap's handle in the hatch word, and paints as [[fn:GDI.CreatePatternBrush]] does. `GetObject` answers the colour given, not nought.
- [[measured]] [[fn:GDI.CreateHatchBrush]] is `CreateBrushIndirect` of `BS_HATCHED`. `GetObject` answers the same `LOGBRUSH`.

winbox.js agrees with all 224 records.

## Nuances

- Not recorded: a hatched brush in `Rectangle`, `Ellipse` or `Polygon`, which fill with its colour alone; a hatch on a monochrome device context; `BS_DIBPATTERN`.
- Not recorded: a `BS_NULL` brush in [[fn:GDI.PatBlt]].

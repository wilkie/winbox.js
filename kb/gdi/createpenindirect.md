---
kind: function
module: GDI
name: CreatePenIndirect
ordinal: 62
summary: Makes a pen from a LOGPEN; with CreatePen, what each pen style draws.
versions:
  '3.1': exact
probes: [penind]
source: src/win16/gdi/CreatePen.ts
topics: [line-drawing, gdi-objects]
---

## Observed behaviour

[[probe:penind]] makes a red pen of each style with [[fn:GDI.CreatePen]] and with `CreatePenIndirect`. It draws lines with [[fn:GDI.MoveTo]] and [[fn:GDI.LineTo]] on a colour bitmap whose device context has a yellow background. Championship Slots of the corpus makes its pens this way.

- [[measured]] [[fn:GDI.GetObject]] answers 10 bytes, the `LOGPEN` as it was given. That includes the width's y, which nothing uses: 77 given is 77 answered. `CreatePen` answers a y of nought.
- [[measured]] Every style is made, even 7, which is past `PS_INSIDEFRAME`.
- [[measured]] `PS_NULL` and style 7 draw nothing. `PS_INSIDEFRAME` a pixel wide draws as `PS_SOLID`. Wider, round a shape with a rectangle, it keeps inside the rectangle and is patterned in a colour the display lacks ([[probe:inframe]], [[topic:ellipses]]).
- [[measured]] The dashed styles, a pixel wide, draw in stretches, each a bit of an eight-bit pattern from the lowest bit up:

  | Style            | Pattern | Along a line that runs across             |
  | ---------------- | ------- | ----------------------------------------- |
  | `PS_DASH`        | `E7h`   | 12 on, 8 off, 12 on                       |
  | `PS_DOT`         | `55h`   | 4 on, 4 off                               |
  | `PS_DASHDOT`     | `27h`   | 12 on, 8 off, 4 on, 8 off                 |
  | `PS_DASHDOTDOT`  | `57h`   | 12 on, 4 off, 4 on, 4 off, 4 on, 4 off    |

- [[measured]] A stretch is four pixels of a line that runs more across than down. On a line that runs down, or at 45 degrees, it is three pixels. Such a line's first pixel is drawn before the first stretch, so its first dash is a pixel longer. The pattern starts again at each line's start, wherever the line starts.
- [[measured]] The gaps are the background colour in `OPAQUE` mode, and are left alone in `TRANSPARENT` mode.
- [[measured]] A dashed pen three wide draws solid.

winbox.js agrees with every record, the wide ones among them. A pen wider than a pixel is swept along the line, as in [[topic:line-drawing]].

## Nuances

- Not recorded: lines of other slopes; whether the pattern carries on from one `LineTo` to the next; styled outlines of `Rectangle`, `Ellipse` and `Polygon`; styles in other drawing modes than `R2_COPYPEN`.
- Not recorded: displays other than the VGA. The stretches of three and four pixels are the VGA's.

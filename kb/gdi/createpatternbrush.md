---
kind: function
module: GDI
name: CreatePatternBrush
ordinal: 60
summary: Makes a brush that paints a bitmap's top-left eight by eight pixels over and over.
versions:
  '3.1': exact
probes: [patbrush, patmono, gdidraw]
source: src/win16/gdi/CreatePatternBrush.ts
topics: [brush-dithering, accessories]
---

## Observed behaviour

- [[measured]] Only the bitmap's top-left eight by eight pixels are used: a 16 by 16 bitmap paints what its corner alone would.
- [[measured]] The brush keeps its own copy. The bitmap can be deleted and the brush paints the same.
- [[measured]] A monochrome pattern's set bits paint the device context's background colour, and its clear bits its text colour, as a monochrome bitmap does in [[fn:GDI.BitBlt]]. The colours are the ones the device context has when it paints, not when the brush was selected.
- [[measured]] The pattern starts at the device context's origin, not at the rectangle painted, as a dithered brush's does ([[topic:brush-dithering]]).
- [[measured]] [[fn:GDI.SetBrushOrg]] moves where it starts, but not for a brush already selected. The brush takes the origin when it is first selected, and keeps it when it is selected again, until [[fn:GDI.UnrealizeObject]]. After that, the next selection takes the new origin. A new brush takes it too.
- [[measured]] [[fn:GDI.GetObject]] answers 8 bytes: a `LOGBRUSH` with `BS_PATTERN`, colour nought, and the bitmap's handle.
- [[measured]] [[fn:USER.FillRect]] paints with it, from the device context's origin, and leaves the device context's own brush selected afterwards. A new device context's brush is the handle [[fn:GDI.GetStockObject]] answers for `WHITE_BRUSH`.
- [[measured]] Sound Recorder greys its disabled buttons' pictures with a pattern brush and the operation `DSPoa`, the destination and (the pattern or the source). The probe records that operation too.

[[probe:patbrush]] records 146 records on the VGA, and winbox.js agrees with all of them.

## Nuances

- `Rectangle`, `Ellipse` and `Polygon` fill through the brush pixel by pixel, in every drawing mode: a pattern brush's pattern, and a solid colour the display dithers as its dithered pattern. BogOut's tiles have sides of `BFBF5F`, which the VGA dithers, and Windows' screen shows them dithered. winbox.js had filled them with the nearest colour.
- A class's background may be a pattern brush, and [[fn:USER.DefWindowProc]] erases the client area with its pattern from the client area's corner. Roulette's table is an 8 by 8 bitmap of green and grey rows, as Windows' screen shows it. winbox.js erased with the pattern's first colour, a plain green. Unmeasured apart from that screen.
- [[measured]] Into a monochrome bitmap too, a monochrome pattern's clear bits are the text colour and its set bits the background colour. With the text colour white and the background black, [[probe:patmono]]'s `00110011` pattern fills as `11001100`. winbox.js had copied the bits as they were.
- [[measured]] [[fn:GDI.CreateDIBPatternBrush]], from a packed DIB, paints the same way ([[probe:gdidraw]]); see [[fn:GDI.SetDIBits]].
- Not recorded: a bitmap smaller than eight pixels, which winbox.js repeats; a colour pattern on a monochrome device context.
- The `DSPoa` case is weak: the pattern's set bits all fall where the source is white.

---
kind: function
module: GDI
name: GetTextMetrics
ordinal: 93
summary: Fills a TEXTMETRIC structure with the metrics of the font selected into a device context.
versions:
  '3.1': partial
probes: [text, maxwidth, rotangle, strikout, pric, ttquery]
topics: [turned-text, printer-drivers, truetype-queries]
---

## Observed behaviour

- [[measured]] For a strike, the metrics are the font file's, scaled where the strike had to be stretched to the requested cell. See [[fonts:3]].
- [[measured]] For a TrueType face, the ascent and descent are those of the size the mapper settled on, and where no width was asked for, `tmMaxCharWidth` is the font's bounding box scaled to the size — not the widest advance. A requested width changes that rule. See [[fonts:5]] and [[fonts:8c]].
- [[measured]] For a TrueType face, the first, last, default and break characters are 30, 255, 31 and 32, as the realised font keeps them (`GDI.EXE` seg3 `21fb`). [[probe:ttquery]] records them in the `TEXTMETRIC` that [[fn:GDI.GetOutlineTextMetrics]] carries, for all five faces.
- [[measured]] For a strike, a synthesised bold widens every character by one pixel and `tmOverhang` becomes 1. See [[fonts:3]] and [[topic:synthetic-bold]].
- [[measured]] On a printer driver's context, the metrics are those of the font the driver realized, read from its `FONTINFO` and `TEXTXFORM` ([[probe:pric]], [[topic:printer-drivers]]).
- [[measured]] A turned font reports the metrics of the size it was realised at under the turned sizing rule. See [[topic:turned-text]].

---
kind: function
module: GDI
name: GetTextMetrics
ordinal: 93
summary: Fills a TEXTMETRIC structure with the metrics of the font selected into a device context.
versions:
  '3.1': partial
probes: [text, maxwidth, rotangle, strikout, pric, ttquery, fontmap]
topics: [turned-text, printer-drivers, truetype-queries, mapping-modes]
---

## Observed behaviour

- [[measured]] For a strike, the metrics are the font file's, scaled where the strike had to be stretched to the requested cell. See [[fonts:3]].
- [[measured]] For a TrueType face, the ascent and descent are those of the size the mapper settled on, and where no width was asked for, `tmMaxCharWidth` is the font's bounding box scaled to the size — not the widest advance. A requested width changes that rule. See [[fonts:5]] and [[fonts:8c]].
- [[measured]] For a TrueType face, the first, last, default and break characters are 30, 255, 31 and 32, as the realised font keeps them (`GDI.EXE` seg3 `21fb`). [[probe:ttquery]] records them in the `TEXTMETRIC` that [[fn:GDI.GetOutlineTextMetrics]] carries, for all five faces.
- [[measured]] For a strike, a synthesised bold widens every character by one pixel and `tmOverhang` becomes 1. See [[fonts:3]] and [[topic:synthetic-bold]].
- [[measured]] On a printer driver's context, the metrics are those of the font the driver realized, read from its `FONTINFO` and `TEXTXFORM` ([[probe:pric]], [[topic:printer-drivers]]).
- [[measured]] A turned font reports the metrics of the size it was realised at under the turned sizing rule. See [[topic:turned-text]].
- [[measured]] Under a mapping mode the metrics are those of the font realised at the size the mapping takes its height to, given back in logical units ([[probe:fontmap]], [[topic:mapping-modes]]). Arial asked for −60 in `MM_LOMETRIC` on the VGA is the font of 18 pixels, 21 high and 8 across on average, and answers 68 high, 55 up, 13 down, 26 across. MS Sans Serif asked for 20 at three units to two pixels is its 13-row strike, answered 20 high. The weight, the characters and the digitized aspect are as they are.
- [[measured]] A stock font keeps its own size: the System font in `MM_LOMETRIC` is its 16 rows, answered 52 high.

## Inside Windows

[[read out]] `GDI.EXE` seg3 `0222` copies the realised font's metrics. In any mode but `MM_TEXT` (the context's mode word at 7Ch is not 1, `0354`), it then turns the height, ascent, descent and both leadings into logical units down (seg1 `3b6e`), and the average and greatest widths and the overhang across (seg1 `3b3a`), `035a`-`0384`. Each is the distance between nought and the value, both turned back with `DPtoLP` (seg1 `52f0`), so its sign is lost. How the font came to its size is [[topic:font-mapper]]'s under a mapping mode.

## Implementation

`get_text_metrics` in `crates/winbox-win16/src/gdi/text.rs`, with `logical_metrics` for the turn back; [[probe:fontmap]] agrees in its mapped cases.

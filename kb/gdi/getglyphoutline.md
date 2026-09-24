---
kind: function
module: GDI
name: GetGlyphOutline
ordinal: 309
summary: Returns the metrics and bitmap of one character of the selected TrueType font, drawn upright at the realised font's size.
versions:
  '3.1': exact
probes: [smearglf]
topics: [turned-text, synthetic-bold]
---

## Observed behaviour

- [[measured]] The bitmap is the character exactly as [[fn:GDI.TextOut]] draws it upright at the realised font's size, hinted: one-pixel strokes for Arial's `A` at fourteen per em.
- [[measured]] It is not turned by the font's escapement — the advance comes back across the page at every angle — but the size is still the turned font's own, so Times New Roman at sixteen answers eleven wide turned and ten upright.
- [[measured]] It is not smeared by a synthesised bold: every plain and smeared pair is byte for byte the same.
- [[measured]] The black box across is the scan converter's, and can carry a blank column the ink does not reach: Times New Roman's `A` at sixteen is ten wide with nine columns inked.
- [[measured]] A strike has no outline: Symbol at sixteen upright, which the mapper hands a bitmap face, fails.

## Nuances

The rows are one bit a pixel, the top row first, each padded to a doubleword, and the return value is their size. `GGO_NATIVE` and any matrix but the identity have not been recorded; winbox.js fails the first and draws the second as the identity.

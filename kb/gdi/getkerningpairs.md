---
kind: function
module: GDI
name: GetKerningPairs
ordinal: 332
summary: Copies the selected TrueType font's kerning pairs, as ANSI characters and amounts in the device context's units, or answers how many it has.
versions:
  '3.1': partial
probes: [ttquery, ttqmap]
topics: [truetype-queries]
---

## Observed behaviour

- [[measured]] With no buffer it answers the font's count of pairs: Arial 105, Arial Bold 101, Times New Roman Italic 120, Times New Roman Bold 124 ([[probe:ttquery]]).
- [[measured]] With a buffer it writes as many pairs as the count asked for allows, in the font file's order, and answers how many it wrote. Asked for eight of Arial's at sixteen pixels, the first is A0h, `A`, −1.
- [[measured]] The space is A0h, not 20h: the glyph both reach is given the higher code.
- [[measured]] The amount is the font's scaled to the pixel size, a half away from nought: −152 units at sixteen per em is −1.
- [[measured]] Courier New, Symbol and Wingdings have no pairs, and the System font none; a device context of nought answers nought.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `1ccd` asks seg7 `1d36`, which asks the TrueType engine (seg36 `0096`, its seg36 `1420`) for the pairs into the program's buffer, as many as six bytes each fit in the count given:

- The engine reads `kern` of version nought, its first subtable whose coverage is 0001h, horizontal and of the first format. With no buffer it answers the pairs' bytes, which GDI divides by six.
- Each glyph becomes the code that reaches it: seg36 `15af` walks the Windows `cmap` from its lowest code up, so a glyph two codes reach keeps the higher.
- Each amount becomes pixels: `MulDiv`-like, a half away from nought, by the pixel size over the units (seg36 `041f`).
- GDI turns each pair's two codes into ANSI characters with seg1 `56a3`, which looks each up in its table of the ANSI set's codes (seg48 `067e`) and gives 1Fh for one it lacks. A pair with a 1Fh is dropped and the rest close up.
- Each amount kept is multiplied by the window extent across and divided by the viewport's (seg1 `41b0`). The answer is how many were kept.

## Nuances

A pair whose first glyph no code reaches would give GDI an empty string, and its second character would be whatever its stack held; no font Windows installs has one.

## Implementation

As read out, in both engines ([[topic:truetype-queries]]). [[probe:ttquery]] agrees in both. Under a mapping mode the font's own height is taken as pixels, so [[probe:ttqmap]]'s amounts are a larger font's.

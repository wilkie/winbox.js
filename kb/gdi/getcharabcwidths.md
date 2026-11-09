---
kind: function
module: GDI
name: GetCharABCWidths
ordinal: 307
summary: Writes, for consecutive characters of the selected TrueType font, the space before each black box, the box's width, and the space after.
versions:
  '3.1': partial
probes: [ttquery, ttqmap]
topics: [truetype-queries]
---

## Observed behaviour

- [[measured]] A is the black box's left edge from the character's origin, B the box's width and C the rest of the advance. They are `GetGlyphOutline`'s box and advance for the same character: Arial's `A` at sixteen per em is 1, 9, 1, and C goes below nought where the box is wider than the advance, as in Times New Roman Italic's `f` at thirty, −5, 19, −6 ([[probe:ttquery]]).
- [[measured]] The space has no box: 0, 0 and its advance.
- [[measured]] The font's first character, 1Eh, is 0, 0, 8 in every face at every size, in pixels: 0, 0, 26 under `MM_LOMETRIC`.
- [[measured]] A character outside the font — under 1Eh — has the default character's, 1Fh's: the face's missing glyph, Arial's 2, 8, 2 at sixteen.
- [[measured]] A range given backwards answers nought and writes nothing. So does a strike, and a device context of nought.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `083d` checks the device context and the buffer, (last − first + 1) × 6 bytes, and seg7 `195c` does the rest:

- The realised font keeps two tables, an advance a character and two signed bytes, A and C (seg3 `2fd8`). The realisation writes the first character's entry itself: an advance of 8, A 0 and C 8 (seg3 `3146`).
- The first time they are asked for, seg7 `1af8` fills the rest, from the font's second character to its last, asking the engine for each character's metrics (seg36 `00a2`). The character is its code in GDI's table of the ANSI set (seg48 `067e`), or the character plus the symbol range's base for a symbol face. A is the box's left edge, rounded; C the advance less A less the box's width. A character the engine fails is given the default character's.
- A character below the font's first or past its last is written as the default character's. Each is written A, then the advance less A less C, then C.
- Under another mapping mode each of the three is turned into logical units across, its sign kept (seg1 `18f5`, `3b3a`).

## Implementation

As read out, the box and advance being `GetGlyphOutline`'s ([[topic:truetype-queries]]). [[probe:ttquery]] agrees in both. Under a mapping mode the font's own height is taken as pixels, so [[probe:ttqmap]]'s widths are a larger font's.

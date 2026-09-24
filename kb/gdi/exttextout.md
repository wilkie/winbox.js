---
kind: function
module: GDI
name: ExtTextOut
ordinal: 351
summary: Draws a string with an optional opaque or clipping rectangle and an optional array of character distances.
versions:
  '3.1': partial
probes: [extout, rotstyle]
topics: [turned-text, text-ground-and-rules]
---

## Observed behaviour

- [[measured]] `ETO_OPAQUE` paints the glyphs' own boxes and not the run's rectangle. See [[fonts:8t]].
- [[measured]] An array of distances replaces the advances. The ground under it differs by kind of face: a strike's runs the pens the array makes plus the last glyph's own advance, while an outline face's takes the array's own sum. See [[fonts:8o]].
- [[measured]] Turned, the array's distances are walked along the turned baseline, and `ETO_CLIPPED` does nothing. See [[topic:turned-text]].
- [[read out]] For TrueType text GDI itself hands the display driver a width array, one word a character; see [[topic:synthetic-bold]].

## Implementation

As for [[fn:GDI.TextOut]], the drawing is replayed through the surface, not through this wrapper, which reads the rectangle and the array from memory. Until this knowledge base was built it also returned `undefined` instead of 1 or 0: it imported its constants from a module that does not export them.

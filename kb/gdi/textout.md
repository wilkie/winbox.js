---
kind: function
module: GDI
name: TextOut
ordinal: 33
summary: Draws a string at a point in the selected font, colours and alignment.
versions:
  '3.1': partial
probes: [glyphs, styles, smearrun, rotstyle]
topics: [synthetic-bold, turned-text, text-ground-and-rules]
---

## Observed behaviour

- [[measured]] Every glyph cell Windows was recorded drawing — strikes, vector fonts and TrueType on four displays — is drawn the same way here. See [[fonts:9]].
- [[measured]] The pen steps by each character's advance plus the character extra; the reference point is placed by the text alignment. See [[fonts:8p]].
- [[measured]] In `OPAQUE` mode the ground is painted behind the text in the background colour. See [[topic:text-ground-and-rules]].

## Implementation

The drawing is recorded exactly, but through the surface's own drawing, which the replay calls directly; this wrapper is not replayed. And it has one known difference: before drawing it fills the text's measured rectangle with the **selected brush**, which Windows does not do — the ground is the background colour, painted only in `OPAQUE` mode, and the drawing already paints it. Hence Partial.

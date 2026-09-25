---
kind: function
module: GDI
name: TextOut
ordinal: 33
summary: Draws a string at a point in the selected font, colours and alignment.
versions:
  '3.1': exact
probes: [glyphs, styles, smearrun, rotstyle, textbk]
topics: [synthetic-bold, turned-text, text-ground-and-rules]
---

## Observed behaviour

- [[measured]] Every glyph cell Windows was recorded drawing — strikes, vector fonts and TrueType on four displays — is drawn the same way here. See [[fonts:9]].
- [[measured]] The pen steps by each character's advance plus the character extra; the reference point is placed by the text alignment. See [[fonts:8p]].
- [[measured]] In `OPAQUE` mode the ground is painted behind the text in the background colour. See [[topic:text-ground-and-rules]].
- [[measured]] The selected brush plays no part. With the black stock brush selected and a white background, in both modes, MS Sans Serif, Arial and System at sixteen pixels come back exactly as with the white brush: 6 of 6 cells of [[probe:textbk]].

## Implementation

Every text replay draws through this call, with the background colour, mode, alignment and character extra set through their own calls, as the probes did. It used to fill the string's measured box with the selected brush before drawing, which could not be seen against the white brush every recording had selected. [[probe:textbk]] now draws with the black brush selected, in both modes, and Windows leaves the cell as the white brush does, so the fill is gone: the ground is the background colour, painted only in `OPAQUE` mode.

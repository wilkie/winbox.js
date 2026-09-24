---
kind: function
module: GDI
name: GetCharWidth
ordinal: 350
summary: Returns the advance widths of a run of characters in the selected font.
versions:
  '3.1': exact
probes: [text, maxorder]
---

## Observed behaviour

- [[measured]] For an outline face each width is the grid-fitted advance the scaler would lay the character out with — the same number a one-character string measures with [[fn:GDI.GetTextExtent]].
- [[measured]] For a strike each width is read from the font file and scaled where the strike was stretched to the requested cell. An earlier implementation read it unscaled, and a 13-pixel MS Sans Serif stretched to 26 answered 7 for `A` where Windows answers 14 — 195 of `groundw`'s 820 records. See [[fonts:8o]].

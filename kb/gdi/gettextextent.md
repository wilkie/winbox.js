---
kind: function
module: GDI
name: GetTextExtent
ordinal: 91
summary: Measures a string in the selected font — its width in the low word, its height in the high word.
versions:
  '3.1': exact
probes: [text, simext, rotherc, hinting]
topics: [synthetic-bold, turned-text, non-square-pixels]
---

## Observed behaviour

- [[documented]] The width comes back in the low word and the cell height in the high word.
- [[measured]] For an outline face, the width is the sum of the grid-fitted advances the scaler lays each character out with — the same advances `TextOut` steps by — at the font's whole horizontal size. See [[fonts:5]].
- [[measured]] A synthesised bold costs a pixel a character on a device that smears for itself; where GDI must draw the bold itself it adds `count + 1` instead. See [[topic:synthetic-bold]].
- Not yet measured: the width under a character extra set by [[fn:GDI.SetTextCharacterExtra]] — in particular whether the gap after the last character counts. See [[fonts:8q]].

## Nuances

- [[read out]] For a **turned** font on a pixel that is not square, the sum is scaled by the length of the baseline's step on the device — `sum * factor >> 8`, the factor a truncated square root — and `ExtTextOut` aligns turned text by this same figure. 216 of 216 in [[probe:rotherc]]. See [[topic:non-square-pixels]].
- [[read out]] The bold's `count + 1` is added **after** that scaling: a turned smeared string is its plain turned length plus `count + 1`, 32 of 32 in [[probe:simext]].

## Inside Windows

[[read out]] `GDI.EXE` ordinal 91 validates its arguments and enters seg1 `3c57`. A TrueType font goes to `6a65`, which sums the width array, scales it for a turned font on a non-square pixel (`6ab0`, factor from seg3 `2615`), and returns; `3cf3`–`3d08` then adds what the device cannot do itself: `count + 1` for a double weight and half the cell less one for a slant.

---
kind: function
module: GDI
name: GetTextExtent
ordinal: 91
summary: Measures a string in the selected font — its width in the low word, its height in the high word.
versions:
  '3.1': exact
probes: [text, simext, rotherc, hinting, fillext, badarg, prtabs, prnote]
topics: [synthetic-bold, turned-text, non-square-pixels, printer-drivers]
---

## Observed behaviour

- [[documented]] The width comes back in the low word and the cell height in the high word.
- [[measured]] For an outline face, the width is the sum of the grid-fitted advances the scaler lays each character out with — the same advances `TextOut` steps by — at the font's whole horizontal size. See [[fonts:5]].
- [[measured]] A synthesised bold costs a pixel a character on a device that smears for itself; where GDI must draw the bold itself it adds `count + 1` instead. See [[topic:synthetic-bold]].
- Not yet measured: the width under a character extra set by [[fn:GDI.SetTextCharacterExtra]] — in particular whether the gap after the last character counts. See [[fonts:8q]].

- [[measured]] Under a mapping mode the width and height are in logical units, whichever way an axis runs: 77 by 16 on the VGA is 250 by 52 in `MM_LOMETRIC` ([[probe:fillext]]).
- [[measured]] `GetTextExtentPoint` puts the same two numbers in a `SIZE` and answers 1. An empty string is 0 by 0.
- [[measured]] A string whose selector names no segment is turned away before it is read: the call answers nought and the program goes on ([[probe:badarg]]). See [[topic:application-errors]].

## Nuances

- [[read out]] For a **turned** font on a pixel that is not square, the sum is scaled by the length of the baseline's step on the device — `sum * factor >> 8`, the factor a truncated square root — and `ExtTextOut` aligns turned text by this same figure. 216 of 216 in [[probe:rotherc]]. See [[topic:non-square-pixels]].
- [[read out]] The bold's `count + 1` is added **after** that scaling: a turned smeared string is its plain turned length plus `count + 1`, 32 of 32 in [[probe:simext]].

## Inside Windows

[[read out]] `GDI.EXE` ordinal 91 validates its arguments and enters seg1 `3c57`. A TrueType font goes to `6a65`, which sums the width array, scales it for a turned font on a non-square pixel (`6ab0`, factor from seg3 `2615`), and returns; `3cf3`–`3d08` then adds what the device cannot do itself: `count + 1` for a double weight and half the cell less one for a slant.

## On a printer driver's context

[[read out]] For a font the driver realized, GDI asks the driver (`GDI.EXE` seg1 `3ba3`). No characters answers nought before anything else (`3c75`). Otherwise, a driver whose `dpRaster` has `RC_GDI20_OUTPUT` is given its `ExtTextOut` with no start and no clip, the string with its count negated, the realized `FONTINFO`, the `DRAWMODE` and the `TEXTXFORM`, and no spacing, rectangle or options. It answers the extent, the height above the width. A driver without `RC_GDI20_OUTPUT` is given its `StrBlt` the same way. The simulations the driver cannot do, `ftAccelerator` less `dpText`, are added as for the display (`3ce5`). Under a mapping mode both are taken back to logical units (`3d0a`).

[[measured]] [[probe:prtabs]], through the PostScript driver: "Tab" in its default Courier is 75 by 42, no characters 0 by 0, and in a Helvetica 60 high 90 by 61. In `MM_LOMETRIC` it is 89 by 60, because GDI realizes the font again at the mapped height ([[topic:printer-drivers]]). [[probe:prnote]]: Notepad pads its header and footer with spaces counted by this extent. Both engines agree.

## Implementation

`driverTextExtent` in `src/win16/gdi/printer-output.ts` and `driver_text_extent` in `crates/winbox-win16/src/gdi/printer_output.rs` measure on a printer driver's context. Not followed there: the driver's `StrBlt`, justification, and GDI's own measure for a font it realized itself.

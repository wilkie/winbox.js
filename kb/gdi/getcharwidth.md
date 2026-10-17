---
kind: function
module: GDI
name: GetCharWidth
ordinal: 350
summary: Returns the advance widths of a run of characters in the selected font.
versions:
  '3.1': exact
probes: [text, maxorder, lbtext]
---

## Observed behaviour

- [[measured]] For an outline face each width is the grid-fitted advance the scaler would lay the character out with — the same number a one-character string measures with [[fn:GDI.GetTextExtent]].
- [[measured]] For a strike each width is read from the font file and scaled where the strike was stretched to the requested cell. An earlier implementation read it unscaled, and a 13-pixel MS Sans Serif stretched to 26 answered 7 for `A` where Windows answers 14 — 195 of `groundw`'s 820 records. See [[fonts:8o]].
- [[measured]] [[probe:lbtext]]: a strike's simulations are in its widths. MS Sans Serif at 11 points, 13 rows, answers 6 for '1' and '2'; asked bold, 8; italic, 12; both, 14 -- each what [[fn:GDI.GetTextExtent]] answers for the one character, and its overhang 1, 6 and 7. Both engines had answered 6 each time.

## Inside Windows

- [[read out]] `GetCharWidth` (`GDI.EXE` seg3 `2098`) asks the display driver for the widths (`call far [bx+38h]`), or the TrueType engine for a TrueType font (`2662`). It then adds to each, for what the text transform asks that the device's `TEXTCAPS` cannot do: two for a double weight without `TC_EA_DOUBLE`, half the height less one for a slant without `TC_IA_ABLE` (`2148`-`218e`; for TrueType both bits are taken off the device's first). Mapped, each is turned into logical units (`2191`).
- [[read out]] `VGA.DRV`'s `GetCharWidth` (seg1 `17dc`) adds two to each width where the text transform's weight is 700 or more over a font lighter than that, where `__WINFLAGS` has `WF_PMODE` and not `WF_CPU286` (`17f6`-`1815`, `18af`): the smear's pixel and its overhang. The VGA's `TEXTCAPS`, 2204h, has `TC_EA_DOUBLE` and lacks `TC_IA_ABLE`, so on it the driver adds the bold and GDI the slant.

## Implementation

`GetCharWidth.ts` and `get_char_widths` in `gdi/text.rs` add the two for a strike the engines smear (`emboldens`) and the slant's half height less one for an italic strike, each width alike. A vector font's and an outline face's widths are as before; neither simulation of theirs is recorded here.

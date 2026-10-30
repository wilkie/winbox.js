---
kind: function
module: GDI
name: EngineGetCharWidth
ordinal: 303
summary: GDI's TrueType engine answering the widths of a font it realized for a printer's driver — the same widths GetCharWidth gives a TrueType font, the default character's for one outside the font.
versions:
  '3.1': exact
probes: [prtteng, prtt]
records: [EngineGetCharWidth, charwidth, extent]
source: src/win16/gdi/engine-glyphs.ts
topics: [printer-drivers, truetype-queries]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]'s driver asks it of Arial, Wingdings, Wingdings slanted by GDI and Arial turned, each at an em of 40 dots at 300 to the inch. It answers 1 and the widths the program's own [[fn:GDI.GetCharWidth]] gets.
- [[measured]] A character below the font's first or past its last, 18h to 1Dh or 100h to 102h, is the default character's width: 30 for Arial, 20 for Wingdings, the width of the glyph that stands for a missing one. Character 1Eh, the font's first, is 8. A last character before the first answers nought and writes nothing.
- [[measured]] The first time a font's widths are asked for, bit 0 of the `FONTINFO`'s byte 33h is set: 80h becomes 81h.
- [[measured]] GDI's slant changes a width: Wingdings' `A` is 23 upright and 24 slanted.
- [[measured]] [[probe:prtt]]: the PostScript driver measures a string of Wingdings, a face it downloads, and of Arial, which it prints as Helvetica, with these widths. `GetTextExtent` answers their sum.

## Inside Windows

[[read out]] `GDI.EXE` seg3 `2c8a`, into `2662`, the path [[fn:GDI.GetCharWidth]] takes for a font GDI draws itself:

- Where the `FONTINFO` has no block of widths at 54h, or the one there was discarded, GDI makes one (seg3 `2f5e`, `2fd3`), clearing bits 0 and 1 of byte 33h. Its widths are filled the first time (seg1 `6d04`): bit 0 set, the engine's context set to the font upright ([[fn:GDI.EngineSetFontContext]]), and the rasterizer asked each character's advance from the first but one to the last. The first is written 8 (`6dd5`). Where the rasterizer fails, bit 6, and the answer is nought from then on.
- A font of fixed pitch, with a width at 14h, answers that width for every character. Otherwise a character outside the font, the first to the last at 1Dh and 1Eh, is the default character. That is kept at 1Fh as a font file keeps it, from the first character, so it is the glyph at 1Fh.
- A turned font's widths are stretched by a factor from its angle and GDI's two pixel shapes, where those differ (`2738`).

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`. The widths are the advances WinBox's rasterizer gives the face at the `FONTINFO`'s em, resolutions and slant. WinBox makes no block at 54h: it asks the face each time, and keeps bit 0 as GDI does.

[[read out]] GDI's own [[fn:GDI.GetCharWidth]] on a printer's context asks the driver's `GetCharWidth` (seg3 `2116`), giving it its `FONTINFO`, GDI's `DRAWMODE` and the `TEXTXFORM`. It adds two to each width for a bold the device cannot make, and half the height less one for a slant (`2148`-`218e`). Both engines now do this; they had answered with WinBox's own widths without calling the driver.

## Not yet done

- A turned font's widths where the display's pixel is not square.

---
kind: function
module: GDI
name: EngineSetFontContext
ordinal: 304
summary: Sets GDI's TrueType engine to a font it realized for a printer's driver, at an angle, ready to make its glyphs with EngineGetGlyphBmp.
versions:
  '3.1': exact
probes: [prtteng]
records: [EngineSetFontContext]
source: crates/winbox-win16/src/gdi/engine_glyphs.rs
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]: for Arial, Wingdings and Wingdings slanted by GDI, at 0, 90 and 45 degrees, it answers nought every time, including the second time it is asked the same.
- [[measured]] The glyphs [[fn:GDI.EngineGetGlyphBmp]] makes afterwards are turned by the angle given, whatever the font's own escapement.
- [[read out]] The PostScript driver sets it before it asks for each glyph of a face it downloads (`PSCRIPT.DRV` seg4 `0805`), giving the angle it keeps for the font; [[probe:prtt]]'s glyphs of Wingdings are made so.

## Inside Windows

[[read out]] `GDI.EXE` seg5 `0993`, into seg1 `6de2` and `6df7`. It takes a `FONTINFO` and an angle in tenths of a degree, and answers a doubleword.

- With TrueType off, or while GDI is making a glyph of its own (bit 9 of `[064Ah]`), nought.
- GDI keeps what the context was last set for in its data segment (`[0662h]`-`[067Ch]`): the face's slot in its TrueType table, the angle, the em, both resolutions, its own slant, the stretch and the spot sizes. Where all are what they were, the answer is what it was.
- Otherwise the face is opened where it is another one (seg36 `0072`). Where it cannot be, the answer is -1.
- The transformation is the em turned by the angle (seg33 `00b6`, `00fb`). Where GDI slants the font (bit 2 of byte 33h), each row is sheared by 57h/100h of the other. The stretch at 4Ah scales the first column, and the resolutions' ratio the across entries (`6fa3`). The rasterizer's answer (seg36 `007e`) is kept and given.

The realization ends by setting the context to the new font at its own escapement (seg3 `2557`). Bit 1 of that answer becomes bit 5 of byte 33h, a font whose glyphs GDI draws as outlines. Filling a font's widths sets it upright (seg1 `6d5c`).

## Implementation

`crates/winbox-win16/src/gdi/engine_glyphs.rs`. The context is the face, found again by the name at 6Eh in the header's weight and slant, realized at the `FONTINFO`'s em and resolutions and turned by the angle. It is kept with what it was set for. The answer is nought, or -1 where no face of that name is installed.

## Not yet done

- What the rasterizer answers beyond nought: bit 1, which no recorded font sets.

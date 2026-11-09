---
kind: function
module: GDI
name: EngineRealizeFont
ordinal: 302
summary: GDI's TrueType engine realizing a font for a printer's driver — with no FONTINFO it answers the size of one, and given one it fills it from the face's .FOT stub at the size the mapper settles.
versions:
  '3.1': partial
probes: [prdlg, pric, prtteng]
source: crates/winbox-win16/src/gdi/engine_font.rs
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] The PostScript driver asks it as it enables a device, and the device is enabled ([[probe:prdlg]], [[probe:pric]]).
- [[measured]] [[probe:pric]] asks the PostScript driver for Arial at -40. The driver realizes it through the engine with a `FONTINFO` to fill, and [[fn:GDI.GetTextMetrics]] and `GetTextFace` answer from it. Both engines agree with all 200 records.

## Inside Windows

[[read out]] `GDI.EXE` seg3 `2b2d`: nought with TrueType off (no TrueType table) and for a `LOGFONT` with no face and a height of nought; any other with no `FONTINFO` answers 96h. Given one, the font is mapped among the TrueType faces and realized into it (seg3 `2841`, `22b3`). The PostScript driver keeps room for the answer doubled, and fails the device on nought (`PSCRIPT.DRV` seg5 `009e`). See [[topic:printer-drivers]].

[[read out]] **Filling a `FONTINFO`** (seg3 `2841`, `22b3`, `220b`, `21b6`) needs the context being realized for, which GDI keeps at `[064Eh]` as it realizes a printer's font. Without one the answer is nought.

- The face is mapped among the TrueType faces and settled at a size: a negative height is the em, a positive one the cell.
- The header comes from the face's `.FOT` stub, in its font units over its em, at that size (`220b`). The points are 72 times the em over the vertical resolution, and the resolutions are the context's logical ones. The ascent and the cell's height are the rasterizer's, where the text is upright and no slant is made (`2506`). The internal leading is the cell less the em. The external leading and the average and widest widths are scaled, the average being the width asked for where there is one. The italic flag is the face's, or FFh for a slant GDI makes. Underline, strike-out, weight, character set, pitch and family, and the first, last, default and break characters come from the stub. The type is 3, with the face's name at 6Eh, and the escapement (48h), the stretch (4Ah) and the em (4Ch).
- [[read out]] Beyond the header (`23f7`-`24d9`): the underline's place and thickness at 34h and 36h, from `post`, and the strike-out's at 38h and 3Ah, from `OS/2`, each scaled to the size, a thickness of nought made 1, and each place made a distance down from the top of the cell (`2522`). A face with no underline thickness or strike-out size has one made from its height (`242e`, `2472`). Then the face's slot in GDI's TrueType table (3Ch), its em in font units (3Eh), the device's spot sizes (40h-46h, the `GDIINFO`'s 60h-66h, which GDI makes B505h each way where the driver left them nought, seg1 `0592`), the offset its characters are found at (4Eh, F000h for Wingdings), and a far pointer to the face's file (50h).
- [[read out]] Last, the engine's context is set to the font at its escapement ([[fn:GDI.EngineSetFontContext]], `2557`), and bit 1 of what that answers becomes bit 5 of byte 33h.
- The `TEXTXFORM` is made from the header (`21b6`). Its height is the cell's and its width the average. Its escapement and orientation are the escapement. Its weight, italic, underline and strike-out are the header's, and the rest is nought.

- [[measured]] [[probe:prtteng]]: the fields beyond the header for Arial, Wingdings, Wingdings slanted by GDI and Arial turned agree in both engines: the slot (0 and 12, `WIN.INI`'s order), the em of 2048 units, the spot sizes, the offset, and byte 33h. [[probe:prtt]]'s PostScript driver writes the underline's place and thickness into the document, 50 and -100 in thousandths of the em.

## Implementation

`crates/winbox-win16/src/gdi/engine_font.rs`. The TypeScript engine had realized the face without the horizontal resolution, at a ratio of 96 to 300. Wingdings' `VDMX` has no group for that ratio, so no size was found and the realization failed; the PostScript driver then printed Wingdings as Symbol.

## Not yet done

- GDI's penalties among faces that are not named.
- The underline and strike-out made from the face's height where it gives none, and the far pointer to the face's file at 50h.
- A width asked for, which WinBox realizes with a stretch of 100h at 4Ah.

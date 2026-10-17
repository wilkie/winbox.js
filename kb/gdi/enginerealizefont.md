---
kind: function
module: GDI
name: EngineRealizeFont
ordinal: 302
summary: GDI's TrueType engine realizing a font for a printer's driver — with no FONTINFO it answers the size of one, and given one it fills it from the face's .FOT stub at the size the mapper settles.
versions:
  '3.1': partial
probes: [prdlg, pric]
source: src/win16/gdi/engine-font.ts
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
- The `TEXTXFORM` is made from the header (`21b6`). Its height is the cell's and its width the average. Its escapement and orientation are the escapement. Its weight, italic, underline and strike-out are the header's, and the rest is nought.

## Implementation

`src/win16/gdi/engine-font.ts` and `crates/winbox-win16/src/gdi/engine_font.rs`.

## Not yet done

- GDI's penalties among faces that are not named.
- The underline and strike-out metrics at 34h–3Ah, and the flags `6de2` adds.
- The rest of the engine's exports.

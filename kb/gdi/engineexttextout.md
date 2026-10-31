---
kind: function
module: GDI
name: EngineExtTextOut
ordinal: 314
summary: GDI drawing a string of a TrueType font for a printer's driver -- through the font's own cache of glyphs, a raster font of 3.0 handed back to the driver's ExtTextOut -- or, given a negative count, measuring it.
versions:
  '3.1': partial
probes: [prtteng, prttxt]
records: [extent, textextent, engine, drawn, font, glyph, dmexttextout, band, bitblt]
source: src/win16/gdi/engine-glyphs.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]'s driver answers [[fn:GDI.GetTextExtent]] with it, the count negative. `abcdefgh` of Arial at an em of 40 is 163 across, the sum of its widths, and 45 down, the font's cell. A character outside the font is the default character's width. With a character extra of 3, 24 more.
- [[measured]] Arial turned 90 degrees is 44 down, the turned font's cell.
- [[measured]] [[probe:prttxt]]: given a count of nought or more, GDI calls the driver's own `ExtTextOut` again, with the same device, place and string but a font of its own -- a raster font of version 3.0, its `FONTINFO` at 42h of its segment, of type 3, characters 1Eh to FFh, the default character 1Fh and the break 20h, the cell the TrueType font's (27 high for Arial at an em of 24, its ascent 21). Each of the string's characters has its glyph there, its width the glyph's ink, not its advance.
- [[measured]] With that call come the widths of each character, its advance -- 17 and 14 for Arial's `Ab` at that size -- and the `DRAWMODE`'s background as transparent. The answer is AX nought; its DX was 2927h in every record.
- [[measured]] `ExtTextOut` with `ETO_OPAQUE` and an opaque rectangle comes as two calls: a count of nought with the options `ETO_OPAQUE | ETO_CLIPPED` and the background opaque, which fills the rectangle; then the string with no options and the background transparent. Widths a program gives come changed, by a pixel here and there to the glyphs' own places.
- [[measured]] An italic font GDI slants itself comes with the string moved right, three pixels at an em of 20.
- [[measured]] A turned string never reaches the driver's `ExtTextOut`: GDI draws each glyph through the driver's `BitBlt`, raster operation E20746h, the glyph's bitmap the source.
- [[measured]] The driver draws GDI's font with [[fn:GDI.DMExtTextOut]] onto a band of its own; the band's bits are recorded.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `669a`. It takes 42 bytes: the device context, then a driver's `ExtTextOut` arguments — the device, the place, the clip, the string, the count, the `FONTINFO`, the `DRAWMODE`, the `TEXTXFORM`, the widths, the opaque rectangle and the options. It answers a doubleword.

- The `FONTINFO`'s block of widths is made again where it was discarded (`6748`).
- For a negative count, the string's extent (`69fe`, into `6a65`), measured with the context's own realized font (`6b73`). Each character's width is the one [[fn:GDI.EngineGetCharWidth]] gives, the context's character extra after each, its justification spread as [[fn:GDI.GetTextExtent]] spreads it, and the cell down. An extent past 7FFFh is 7FFFh. A font whose widths could not be filled answers nought across and 8000h down. A turned font's extent is stretched where GDI's two pixel shapes differ.
- Otherwise the context's device, its word 2Ah, is made the one given, and its flag 1 at 0Ah set, while GDI draws the string itself (`6223`); then both are put back.

[[read out]] GDI's drawing of a TrueType string, seg1 `6223`: with TrueType off (`[064Ah]` bit nought clear), or a font flagged 40h at 33h, AX nought and DX 8000h. The glyphs of the string are made ready in the font's cache (`7010`): the cache, the global block at the font's 54h, is a raster font file of 3.0, its character table at 94h, a glyph's offset nought until it is made; each character of the string without a glyph has it made by the rasterizer (`70b3`), a character outside the font the default's; then the cache's `dfBitsPointer` set from its `dfBitsOffset` and the font answered as the cache's segment and 42h (`7187`-`719a`). The widths are laid by `6874`. The driver is called through the context's table, entry 34h -- its `ExtTextOut` -- with GDI's copy of the `DRAWMODE` and the cache's font (`65be`-`663a`). A turned font (flag 10h at 33h) goes by `63ea`, drawing glyph by glyph.

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`: the extent, with the `FONTINFO` given, which a driver hands on from its own `ExtTextOut`. A count of nought or more answers nought and draws nothing; [[probe:prttxt]]'s drawing records are known gaps.

## Not yet done

- Drawing the string: GDI's cache of the font's glyphs as a raster font, its glyphs the rasterizer's, the widths `6874` lays, and the call back to the driver's `ExtTextOut`; the opaque rectangle's own call; a turned string's glyphs through the driver's `BitBlt`. All recorded by [[probe:prttxt]].
- The context's own realized font, where a driver gives another.
- A turned font's extent where the pixel is not square.

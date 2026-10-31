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
source: src/win16/gdi/engine-text.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]'s driver answers [[fn:GDI.GetTextExtent]] with it, the count negative. `abcdefgh` of Arial at an em of 40 is 163 across, the sum of its widths, and 45 down, the font's cell. A character outside the font is the default character's width. With a character extra of 3, 24 more.
- [[measured]] Arial turned 90 degrees is 44 down, the turned font's cell.
- [[measured]] [[probe:prttxt]]: given a count of nought or more, GDI calls the driver's own `ExtTextOut` again, with the same device, place and string but a font of its own -- a raster font of version 3.0, its `FONTINFO` at 42h of its segment, of type 3, characters 1Eh to FFh, the default character 1Fh and the break 20h, the cell the TrueType font's (27 high for Arial at an em of 24, its ascent 21). Each of the string's characters has its glyph there, its width the glyph's ink, not its advance. Its `dfBitsOffset` is A66h for Arial at 24, A36h for Arial bold at 18 and A3Eh for Wingdings at 20.
- [[measured]] With that call come the widths of each character, its advance -- 17 and 14 for Arial's `Ab` at that size -- and the `DRAWMODE`'s background as transparent.
- [[measured]] The answer is the `PDEVICE` GDI handed the driver, in every record: DX the `PDEVICE`'s selector, which was 2927h, AX nought.
- [[measured]] `ExtTextOut` with `ETO_OPAQUE` and an opaque rectangle comes as two calls: a count of nought with the options `ETO_OPAQUE | ETO_CLIPPED` and the background opaque, which fills the rectangle; then the string with no options and the background transparent. Widths a program gives come changed, by a pixel here and there to the glyphs' own places.
- [[measured]] An italic font GDI slants itself comes with the string moved right, three pixels at an em of 20.
- [[measured]] A turned string never reaches the driver's `ExtTextOut`: GDI draws each glyph through the driver's `BitBlt`, raster operation E20746h, the glyph's bitmap the source, cut to the device -- Arial's `Ab` turned 90 degrees at 10,10 is one blit of the `A`, 17 by 10 at 15,0 from 0,5 of the glyph, the `b` falling above the device.
- [[measured]] The driver draws GDI's font with [[fn:GDI.DMExtTextOut]] onto a band of its own; the band's bits are recorded.

## Nuances

- The width the driver is given for a glyph is its advance moved by the difference of its A space and the next one's, so that a driver drawing the ink one after another puts each where its outline would be; the string starts at the first glyph's A space past the place. A turned string's widths are the advances alone.
- The font GDI hands back is the context's own realized `FONTINFO`'s, not the one the driver passed.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `669a`. It takes 42 bytes: the device context, then a driver's `ExtTextOut` arguments — the device, the place, the clip, the string, the count, the `FONTINFO`, the `DRAWMODE`, the `TEXTXFORM`, the widths, the opaque rectangle and the options. It answers a doubleword.

- The `FONTINFO`'s block at 54h is made again where it was discarded (`6748`, into seg3 `2f5e`); nought answered where it cannot be.
- For a negative count, the string's extent (`69fe`, into `6a65`), measured with the context's own realized font (`6b73`). Each character's width is the one [[fn:GDI.EngineGetCharWidth]] gives, the context's character extra after each, its justification spread as [[fn:GDI.GetTextExtent]] spreads it, and the cell down. An extent past 7FFFh is 7FFFh. A font whose widths could not be filled answers nought across and 8000h down. A turned font's extent is stretched where GDI's two pixel shapes differ.
- Otherwise the context's device, its word 2Ah, is made the one given, and its flag 1 at 0Ah set, while GDI draws the string itself (`6223`); then both are put back, and the device as it was is the answer (`672b`-`6740`) -- whatever the drawing came to, the drawing's own answer, nought and 8000h where it fails, thrown away. That is the DX 2927h of the records: the selector of the probe's `PDEVICE`.

[[read out]] The cache block (seg3 `2f2a`, `2fd3`). For a `FONTINFO` flagged 80h at 33h, which every one the engine realizes is, a raster font file of version 3.0: its character table at 94h, six bytes an entry; else 2.0, at 76h, four. Its two widths-filled flags at 33h are cleared. After the table, one entry more than the characters, come a word for each character's advance, a word of its A and C spaces, 20h bytes for the face's name, and the rasterizer's scratch -- the widest glyph's bytes a row, `(dfMaxWidth + 3Fh) / 8` with its low two bits cleared, times the cell; none for a turned font -- and then the glyphs. The block is `GlobalAlloc(2042h)` of that and a glyph area more: the average glyph's bytes times 20 under 20 points, 15 under 35, 10 under 60, 5 under 90, 3 under 150, else once, and 400h at least. Its header: the version, the size, the copyright `MicroSoft (c) 1990 - This is an awesome engine font!`, then the `FONTINFO`'s first 23h bytes with bit 0 of the pitch set, `dfFace` the name's place, `dfBitsOffset` the glyphs'. The first character, 1Eh, is 8 wide, its glyph the scratch. In the `FONTINFO`: the handle at 54h, the scratch and its size at 56h and 58h, the tables at 5Ah and 5Ch, the size at 5Eh, the glyph area at 62h, the next glyph's place at 66h and what is left at 6Ah -- those two written at 66h and 6Ah of the `FONTINFO`'s segment, its `FONTINFO` starting a block of its own.

[[read out]] GDI's drawing of a TrueType string, seg1 `6223`: with TrueType off (`[064Ah]` bit nought clear), or a font flagged 40h at 33h, nothing. The glyphs of the string are made ready in the font's cache (`7010`): each character of the string without a glyph has it made by the rasterizer (`70b3`, into `7222`), a character outside the font the second's, the default; the engine's context set to the font at its angle once (`74d7`). An upright glyph's entry has its width, at least 1, and its place; its bytes are laid a column of the cell at a time, its top row at the ascent less the glyph's top, what falls outside the cell left off; its advance goes in the widths, its left and what the advance leaves past its right in the spaces (`7300`-`7404`). A turned glyph is kept as the rasterizer made it, a row a doubleword's multiple, after 12 bytes of its width, height and corner (`752d`). A block too small grows by its glyph area (`71a6`), past 64K only for version 3.0; one that cannot grow is made again once (`71fd`). A glyph the rasterizer fails is the default's (`70ec`). Then the cache's `dfBitsPointer` set from its `dfBitsOffset` and the font answered as the cache's segment and 42h (`7187`-`719a`).

[[read out]] The widths, `6874`: a font of fixed pitch with nothing more its pitch; the widths given where there is nothing else; else the cache's advances with the character extra (and a pixel for a bold the device's `dpText` makes, `TC_EA_DOUBLE` in the `TEXTXFORM` too, `6b73`), or, with breaks or negative spacing, each character's own (`6ba7`), a break's share of the justification spread by its error term, which is kept in the context. Upright, each width is moved by the next glyph's A space less its own (`6986`).

[[read out]] The calls, `637f`-`656b`, through the context's table, entry 34h, its `ExtTextOut` (`65be`-`663a`), with GDI's copy of the `DRAWMODE` -- its justification and character extra nought -- and the cache's font. Which arguments go is a flag byte: the count or nought, GDI's widths or none, the opaque rectangle given or the text's own box, and the options given, given less `ETO_OPAQUE`, or 6. No characters: one call with what was given. A driver whose `dpRaster` has `RC_OP_DX_OUTPUT` (4000h) draws an opaque background in its one call. Otherwise an opaque background is a call of no characters filling the rectangle, the options 6, where `ETO_OPAQUE` and a rectangle are given (`6521`); one filling the text's box where the rectangle does not hold it, cut to it for `ETO_CLIPPED` (`6548`); then the string, transparent. A driver without `RC_GDI20_OUTPUT` (10h), and a font GDI draws as an outline (20h at 33h), go by seg8 `00e4`: GDI's own fill and the driver's `StrBlt` a character at a time.

[[read out]] A turned font (flag 10h at 33h) goes by seg8 `024b`: a brush of the text colour selected, the text white and the background black (`002d`, `0268`); the first baseline point the place moved by the ascent, turned by GDI's own sine and cosine (seg33 `00b6`, `00fb`: a table of each degree's sine times 10000, the tenths between taken in proportion, `MulDiv` each), across by the resolutions' ratio; each glyph at the baseline point of the widths before it, moved by its corner, through seg1 `2ef2`: the driver's `BitBlt` for each rectangle of the clip within the glyph's box, top down, the source a monochrome `BITMAP` of the glyph -- its width taken up to 32 -- and the raster operation of the context's `ROP2` from a table at seg8 `020b`, E20746h for `R2_COPYPEN`. An opaque background is a region of the turned box GDI fills first (`63ea`-`64be`).

[[read out]] GDI's own `ExtTextOut` on a driver's context draws a turned engine font itself, without the driver's `ExtTextOut` (seg1 `3a1a`-`3a86`, into `620e`, which makes the block and goes to `6223`): where the device's `GDIINFO` word 5Eh has no bit 2, the context's flag 4 at 0Bh is set, the realized font is of type 3 and turned, and there are characters. [[measured]] So [[probe:prttxt]]'s driver logs no `engine` for a turned string, only the blits. WinBox takes the context's flag as set for a font the driver realized ([[inferred]]: seg3 `0261`-`0272` sets it apart from flag 10h, a font GDI draws itself).

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`: the extent, with the `FONTINFO` given, which a driver hands on from its own `ExtTextOut`. `src/win16/gdi/engine-text.ts` and `crates/winbox-win16/src/gdi/engine_text.rs`: the drawing, the cache laid out from named constants as GDI lays it, its glyphs the rasterizer's ([[fn:GDI.EngineGetGlyphBmp]]'s). [[probe:prttxt]] agrees in every record, in both engines.

## Not yet done

- The context's own realized font, where a driver gives another, for the extent.
- A turned font's extent where the pixel is not square.
- A turned string's opaque background; the driver's `StrBlt` a character at a time for a driver without `RC_GDI20_OUTPUT`, or a font GDI draws as an outline; the count cut to what GDI's stack holds (`62a5`); the context's flag 40h at 0Bh, which counts a string as turned.
- The `DRAWMODE` handed on for no characters, which is what GDI's stack held there.

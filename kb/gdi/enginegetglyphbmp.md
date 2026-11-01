---
kind: function
module: GDI
name: EngineGetGlyphBmp
ordinal: 305
summary: A character's glyph from GDI's TrueType engine for a printer's driver, as the engine's context makes it — a 24-byte record of its box, corner and advance, and its bitmap.
versions:
  '3.1': partial
probes: [prtteng, prtt, prttrot, prttslt]
records: [EngineGetGlyphBmp, line, size]
source: src/win16/gdi/engine-glyphs.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]: Arial's `A` at an em of 40 answers 116, a box 27 wide and 29 high, its corner at 0 across and 29 up, and an advance of 27. Each is a doubleword, the last four 16.16. The bitmap is a bit a pixel, the top row first, each row a doubleword.
- [[measured]] A space answers nought, a box of nought and an advance of 11. Characters 1Eh and 1Fh are the glyph that stands for a missing one.
- [[measured]] Format nought fills the record and answers nought, the buffer untouched. Format 1 with no buffer answers the size and writes nothing. With a buffer of 8 bytes it still answers the whole size, and the 8 bytes are the bitmap's first.
- [[measured]] The context's angle turns the glyph: at 90 degrees Arial's `A` is 29 by 27, its corner at -29 across and 27 up, its advance 27 up. At 45 degrees the advance is 19 each way.
- [[measured]] Wingdings' characters are found through its offset, F000h: its `a` is the glyph at F061h. GDI's slant slants the glyph.
- [[measured]] [[probe:prttslt]]: slanted, a glyph leans by GDI's matrix -- `(57h * em) >> 8` across for each em down -- not by the display's synthesis, `floor(em / 3)`: from an em of 53, where the two part (18 and 17), Wingdings' `A`, `a` and `l` are a column wider than the display's slant would make them, and agree to the bit drawn with the matrix's lean.
- [[measured]] Symbol slanted has its corner's x with a fraction: `S` and `W` at `7/256` of the em -- 11800h at 40, 1C000h at 64 -- and `a` at 3A400h at 40.
- [[measured]] [[probe:prtt]]: the PostScript driver downloads each glyph of Wingdings it prints as a bitmap from this, writing the record's numbers beside it, `/G61 [109.0 0.0 8.0 0.0 100.0 72.0]`. Every one of the four glyphs' lines agrees.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `09e9`. It takes a device context, a `FONTINFO`, a character, a format, a buffer and its size, and a record to fill, 22 bytes in all, and answers a doubleword.

- With TrueType off, -1.
- The character is found at itself plus the `FONTINFO`'s offset at 4Eh, where it has one; otherwise through GDI's table of the ANSI characters' codes (`0a13`, seg48 `067e`).
- Format 2, the outline as curves, goes to the rasterizer at once. For a font GDI draws as outlines itself (bit 5 of byte 33h) the outline is filled into a bitmap of GDI's own through the context given (`0a55`-`0d0f`). Otherwise the rasterizer (seg36 `00a2`) makes the glyph with the engine's context ([[fn:GDI.EngineSetFontContext]]) and fills the record. Its failure is -1, and the record is made nought.
- The rasterizer is entered through a table of far pointers in GDI's segment 47 (seg36 `00a2`, `00e1`-`011e`, entry 10h: seg36 `0aa3`). The record's advance is copied from its output's 16.16 pair at 5Ah (`0dc3`-`0dd9`), which is the difference of the glyph's two phantom points, after the glyph's program has run, each 26.6 word turned to 16.16 by a shift of 10 (`1f46`-`1fdb`); the record's corner from the pair at 62h (`0d42`-`0d58`). Where the request asks it (bit 3 of its flags), each half of the advance is rounded to a whole pixel by adding 8000h and clearing the fraction (`0e07`-`0e3d`).
- [[read out]] Where the advance comes from depends on the matrix GDI set the context to (seg1 `6f22`-`6fce`: whole pixels, the em times GDI's own cosine and sine; its slant adding `(57h * m00) >> 8` to `m10` and `(57h * m01) >> 8` to `m11`, 13 at an em of 40; a stretch on `m00` and `m01`; the resolutions' ratio on `m00` and `m10`). Only a matrix with nothing off its diagonal and the same positive entry on it asks `hdmx` and `LTSH` (seg36 `081b`-`0845`, `0957`, `103b`-`10d5`); every other takes the phantom points'. The outline is scaled at each row's stretch, the larger of its two entries (`3ff9`, `3f16`) -- 28, not 39.6, at 45 degrees and an em of 40 -- and every point, the phantoms too, turned afterwards by the entries divided by it (`4c15`, `6ebb`). Whether the glyph's program runs is the font's: `prep` runs with `GETINFO`'s rotated flag (`6641`) set from the matrix by `3e38` -- something off the diagonal and not a turn by a right angle, whose diagonal is nought -- and its stretched flag where the diagonal's entries differ other than in sign (`4267`-`4299`); every installed face answers rotated with `INSTCTRL`, and `4bb2` reads it to run the glyph unhinted. Hinted, the origin phantom is rounded to a pixel and the advance phantom to a pixel from it before the program (`4882`-`4926`); unhinted both stay where scaling put them.
- [[measured]] [[probe:prttrot]] reads the scaler's memory with `TOOLHELP` after each glyph: Wingdings' `A` at an em of 40 has its advance phantom at 24.0 upright, where the record carries `hdmx`'s 23, and at 24.0 turned by right angles, which the record carries; at 45 degrees, slanted or not, 16.45 each way, unhinted at a stretch of 28; slanted upright 23.5, unhinted, which rounds to 24. The key's stretches read 40 upright and at right angles and 28 at 45 degrees; the instruction control `prep` left reads 1 where the matrix is rotated.
- [[fn:GDI.GetGlyphOutline]] is this, called with its own context set (seg7 `1059`). It turns the record into a `GLYPHMETRICS`: the box's two words, and the last four rounded to whole pixels (`1068`).

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`. The glyph is drawn as `GetGlyphOutline` draws one, by the face the engine's context holds, turned by its angle. Turned, the box is the ink's and the corner is measured from where the baseline's origin falls as the character would be drawn. The context keeps GDI's matrix (`engineMatrix`); where it is not a plain upright scale the advance is the scaler's phantoms', made as read out above (`engineAdvance`), both engines alike, and otherwise the upright face's. GDI's slant leans the outline by the matrix's `m10` over `m11` (`engineLean`, the `Outline`'s `lean`), not the display's `floor(em / 3)`.

## Not yet done

- Format 2, which answers -1 here as `GetGlyphOutline`'s does.
- Slanted Wingdings' E9h ([[probe:prtteng]], [[probe:prttrot]], [[probe:prttslt]], known gaps): at an em of 40 Windows' box is a column wider on the left, 33 to WinBox's 32, its corner at 4 across -- the one pixel in that column the bottom of the arrowhead's left tip, a dropout rescued where WinBox clamps the rescue to its box; at 48 to 72 a row more at the top, or more. Its advance agrees. The scan converter's rule there, under the rotated `prep`'s scan control, is not read out.
- Symbol slanted ([[probe:prttslt]], known gap): the corner's fraction across; its bitmaps agree.
- A pixel of a few other slanted glyphs at 48 to 60 ([[probe:prttslt]]).
- The scaler's matrix shifted down where an entry would overflow (seg36 `08bb`-`0912`, the shift at 9Ch) and the advance shifted back up (`0dda`): no em a probe asks reaches it.
- A font GDI draws as outlines itself, which no font WinBox realizes is.

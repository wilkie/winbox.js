---
kind: function
module: GDI
name: EngineGetGlyphBmp
ordinal: 305
summary: A character's glyph from GDI's TrueType engine for a printer's driver, as the engine's context makes it — a 24-byte record of its box, corner and advance, and its bitmap.
versions:
  '3.1': partial
probes: [prtteng, prtt]
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
- [[measured]] [[probe:prtt]]: the PostScript driver downloads each glyph of Wingdings it prints as a bitmap from this, writing the record's numbers beside it, `/G61 [109.0 0.0 8.0 0.0 100.0 72.0]`. Every one of the four glyphs' lines agrees.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `09e9`. It takes a device context, a `FONTINFO`, a character, a format, a buffer and its size, and a record to fill, 22 bytes in all, and answers a doubleword.

- With TrueType off, -1.
- The character is found at itself plus the `FONTINFO`'s offset at 4Eh, where it has one; otherwise through GDI's table of the ANSI characters' codes (`0a13`, seg48 `067e`).
- Format 2, the outline as curves, goes to the rasterizer at once. For a font GDI draws as outlines itself (bit 5 of byte 33h) the outline is filled into a bitmap of GDI's own through the context given (`0a55`-`0d0f`). Otherwise the rasterizer (seg36 `00a2`) makes the glyph with the engine's context ([[fn:GDI.EngineSetFontContext]]) and fills the record. Its failure is -1, and the record is made nought.
- The rasterizer is entered through a table of far pointers in GDI's segment 47 (seg36 `00a2`, `00e1`-`011e`, entry 10h: seg36 `0aa3`). The record's advance is copied from its output's 16.16 pair at 5Ah (`0dc3`-`0dd9`), which is the difference of the glyph's two phantom points, after the glyph's program has run, each 26.6 word turned to 16.16 by a shift of 10 (`1f46`-`1fdb`); the record's corner from the pair at 62h (`0d42`-`0d58`). Where the request asks it (bit 3 of its flags), each half of the advance is rounded to a whole pixel by adding 8000h and clearing the fraction (`0e07`-`0e3d`).
- [[fn:GDI.GetGlyphOutline]] is this, called with its own context set (seg7 `1059`). It turns the record into a `GLYPHMETRICS`: the box's two words, and the last four rounded to whole pixels (`1068`).

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`. The glyph is drawn as `GetGlyphOutline` draws one, by the face the engine's context holds, turned by its angle. Turned, the box is the ink's, the corner is measured from where the baseline's origin falls as the character would be drawn, and the advance is carried along the baseline, each part rounded away from nought.

## Not yet done

- Format 2, which answers -1 here as `GetGlyphOutline`'s does.
- Three of [[probe:prtteng]]'s records, known gaps -- the advance is the phantom points' (above), so what moves them under a turn or GDI's slant is the glyph program's run (seg36 `4b81`, into `263a`) and the scaling before it, not read out yet. [[measured]] What the records show of it: Wingdings' `A` (23 hinted upright, 23.496 unhinted) carries 24 turned 90 degrees and 24 slanted, the unhinted advance at a 64th rounded up, but 16 each way at 45 degrees, slanted or not -- the hinted 23 turned -- where Arial's `A` (27, 26.68) comes out alike either way. Wingdings' `A` at 90 degrees: Windows' advance is 24, one more than upright, where WinBox carries the upright 23. Slanted Wingdings' E9h: Windows' box is a pixel wider on the left. Slanted Wingdings' `A` at 45 degrees: Windows' advance is 16 each way, the upright one carried, where WinBox carries the slanted 24.
- A font GDI draws as outlines itself, which no font WinBox realizes is.

---
kind: topic
name: Asking about a TrueType font
summary: What GDI answers about a TrueType font beside drawing it — the file's tables, the kerning pairs, each character's ABC widths and the outline metrics — read out of GDI.EXE's TrueType engine and GDI's side of it, and recorded.
probes: [ttquery, ttqmap]
---

Four calls ask about the TrueType font selected into a device context rather than draw with it: [[fn:GDI.GetFontData]], [[fn:GDI.GetKerningPairs]], [[fn:GDI.GetCharABCWidths]] and [[fn:GDI.GetOutlineTextMetrics]]. Each asks GDI's TrueType engine, which lives in `GDI.EXE` itself: its entry points are a table at seg47 `001e`, which seg36's stubs `0042` to `00ae` call through. A strike — any font that is not a TrueType one — has none of these answers.

[[measured]] [[probe:ttquery]] asks all four of Arial, Arial Bold and Bold Italic, Times New Roman Italic and Bold, Courier New, Symbol and Wingdings at a few sizes, in a window's device context and a memory one, and of the System font. All 226 records agree. [[probe:ttqmap]] asks the same under `MM_LOMETRIC`.

## The engine's part

- [[read out]] **A table's bytes** are read from the font's file (seg40 `0113`): a table of nought is the whole file, a tag the directory lacks is -1, what is left past the offset is -1 where it is nought or less and is cut to the size given.
- [[read out]] **Kerning pairs** are `kern`'s first horizontal subtable of the first format (seg36 `1420`). Each glyph becomes the highest code of the Windows `cmap` that reaches it (seg36 `15af`), so the space is A0h. Each amount becomes pixels by the pixel size over the units, a half away from nought (seg36 `041f`).
- [[read out]] **Outline metrics** are built in font units (seg40 `0606`) from `OS/2`, `hhea`, `head` and `post`; the cap and x heights are half and a quarter of the EM, the engine having no other source for them. See [[fn:GDI.GetOutlineTextMetrics]].
- [[read out]] **A character's metrics** (seg36 `00a2`) are its box and advance, the same the engine gives `GetGlyphOutline`.

## GDI's part

- [[read out]] **The ANSI set.** GDI keeps each ANSI character's UTF-16 code in its data segment (seg48 `067e`): the character's own, but for the C1 block's punctuation, 2219h for B7h, and nought for 1Fh. It looks characters' codes up there, and looks codes up the other way with seg1 `56a3`, the first character whose code it is, 1Fh for none.
- [[read out]] **The realised font's characters** are 1Eh to FFh, default 1Fh, break 20h (seg3 `21fb`); so [[fn:GDI.GetTextMetrics]] answers 30, 255, 31 and 32 for a TrueType face ([[measured]] [[probe:ttquery]]). Its first character's ABC widths are never asked of the engine: the realisation writes them, 0, 0 and 8 pixels (seg3 `3146`).
- [[read out]] **Scaling.** Outline metrics are scaled with the half added before a signed division, which truncates; kerning amounts by `MulDiv` a half away from nought.
- [[read out]] **Mapping modes.** Each turns its pixels into the device context's units: ABC widths across, the outline metrics mostly down, kerning amounts by the extents across.

## In winbox.js

The engine's part is `crates/winbox-raster/src/truetype_queries.rs`, reading the face's file. GDI's part is `crates/winbox-win16/src/gdi/text/queries.rs`. ABC widths are taken from `GetGlyphOutline`'s box and advance. The filler byte of `OUTLINETEXTMETRIC`, which Windows leaves as its stack had it, is written nought.

## Not yet done

- **Fonts under a mapping mode.** Windows realises a font's height in the device context's units; WinBox takes it as pixels ([[topic:mapping-modes]]). [[probe:ttqmap]]'s `GetFontData` agrees; its widths, kerning amounts and outline metrics are those of a font three times the size, and are listed among the known gaps.
- The engine's own failure for a character, which GDI answers with the default character's widths, has not been seen: every character of the installed faces has a glyph, the missing glyph standing for those without.
- A Macintosh-only `cmap` or name table, which the engine turns into codes through its table of the Macintosh character set (seg39 `0000`); no installed face has one.

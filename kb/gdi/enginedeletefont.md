---
kind: function
module: GDI
name: EngineDeleteFont
ordinal: 301
summary: Lets go a font GDI's TrueType engine realized for a printer's driver -- frees the block it keeps of the FONTINFO -- and answers 1.
versions:
  '3.1': partial
probes: [prtt]
records: [call]
source: src/win16/gdi/engine-font.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] The PostScript driver lets its TrueType fonts go as the device context is deleted, and `DeleteDC` answers 1 ([[probe:prtt]]).

## Inside Windows

[[read out]] `GDI.EXE` seg6 `0560`: the pointer is not checked. Where the `FONTINFO`'s type, the low two bits of its first byte, is 3 and its word 27h points at its own 6Eh -- where the engine writes the face's name -- the word at 54h, the block the engine keeps of the font's glyphs, is freed with `GlobalFree` and made nought. 1 is answered either way.

## Implementation

In both engines as read out; a null pointer answers 1. WinBox's engine keeps no block at 54h of its own (see [[fn:GDI.EngineRealizeFont]]), so only one a driver left there is freed.

## Not yet done

- The rest of the engine a printer's driver downloads a face with: `EngineGetGlyphBmp` (seg7 `09e9`, the rasterizer's bitmap and a 24-byte metrics record) and `EngineSetFontContext` (seg5 `0993`, into seg1 `6de2`). [[probe:prtt]] records what the PostScript driver sends for Wingdings; WinBox's document differs from where the face is defined.

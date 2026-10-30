---
kind: function
module: GDI
name: EngineMakeFontDir
ordinal: 306
summary: Writes the font directory entry of a TrueType file into a caller's buffer — the entry CreateScalableFontResource puts in the .FOT it makes — and answers its length.
versions:
  '3.1': exact
probes: [prtteng]
records: [EngineMakeFontDir]
source: src/win16/gdi/engine-glyphs.ts
topics: [font-resources]
---

## Observed behaviour

- [[measured]] [[probe:prtteng]]: for `ARIAL.TTF` it answers 138 and writes the entry Arial's `.FOT` holds: a count of 1, an ordinal of nought, the header from `dfVersion` to `dfBreakChar`, and `Arial`, `Arial` and `Regular`. For `WINGDING.TTF`, 146, the symbol set and an offset of F000h.
- [[measured]] What it does not write it leaves as it was: 1Dh bytes after the copyright, six after `dfBreakChar`, two after `dfFace` and one before the names, and every byte past the answer.
- [[measured]] `dfType` is 4083h where the first argument is not nought, 4003h where it is.
- [[measured]] `dfFace` is the offset of the names in the caller's own segment, not in the entry.
- [[measured]] For a file that is not there it answers -1.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `1184`. It takes a word, a buffer and a path, 10 bytes, and answers a doubleword. [[fn:GDI.CreateScalableFontResource]] calls it with its `fHidden` and a block of FBh bytes (seg7 `1585`).

- With TrueType off, -1. The file is opened by the rasterizer and its facts read (seg36 `0042`, `004e`); -1 where it cannot be, or a name is longer than the room GDI keeps.
- 29h bytes are copied from GDI's code (`1147`): the count, the ordinal, `dfVersion` 200h, `dfSize` 95h, and `Windows! Windows! Windows!` with its nought and the four bytes `10 03 01 01` after it.
- From 46h: `dfType` 3, 80h more for the first argument, and `OS/2`'s `fsSelection` as its high byte. Then the em in font units as `dfPoints`, 72 each way, the ascent, the internal leading and the external leading, never below nought. Italic, underline and strike-out are FFh for `fsSelection`'s bits 0, 1 and 4. The weight class is taken as hundreds where it is 1 to 9 (`1170`). The character set is 2 for a pictorial PANOSE family.
- Then nought, the cell, the pitch and family from PANOSE, the average width and the width of the box. The family is script or decorative by the PANOSE family, modern for a monospaced face, and otherwise by its serif style (`12af`, `1137`); a face that is not monospaced is of variable pitch.
- The characters run from 20h less two to the last, at most FFh. A face whose characters start past FFh is of the symbol set: its characters count on from 20h for as many as it has, to FFh at most, and 20h short of its first is its offset. The default character is 1 and the break 2, from the first.
- `dfFace` is the offset of the names; then `head`'s lowest size, the offset, and the full name, the family and the style, each turned from Unicode by GDI's ANSI table (seg1 `56a3`) and ended with nought. The answer is 76h and the names' length.

## Implementation

`src/win16/gdi/engine-glyphs.ts` and `crates/winbox-win16/src/gdi/engine_glyphs.rs`, reading the face's file through DOS. The facts are the ones `CreateScalableFontResource`'s stub is built from (`trueTypeFacts`), with `fsSelection` and the last character beside them.

## Not yet done

- The rasterizer's refusals: a name too long, or a file that is not a face.
- An average width of nought, which GDI takes from another field.
- `CreateScalableFontResource` writes the entry from its own builder, `dfType` 4083h always; [[probe:fotmake]] records only hidden faces.

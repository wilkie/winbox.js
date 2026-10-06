---
kind: function
module: GDI
name: SelectObject
ordinal: 45
summary: Selects a pen, brush, font, bitmap or region into a device context and answers what it replaced.
versions:
  '3.1': exact
probes: [selbmp, selrgn, stockdel, patmono]
source: src/win16/gdi/SelectObject.ts
---

## Observed behaviour

- [[measured]] **Only a memory device context takes a bitmap.** [[probe:selbmp]] selects a bitmap into four other kinds of context: a window's from [[fn:USER.GetDC]], [[fn:USER.BeginPaint]]'s, the screen's from `GetDC(NULL)`, and one [[fn:GDI.CreateDC]] made for `DISPLAY`. Each answers nought. A `PatBlt` through the context afterwards still lands on the screen, and the bitmap stays black. A memory context's first bitmap and the handle 1 are refused the same way, and the context's clip box is unchanged after all three.
- [[read out]] GDI tests the context's flags, bit 0 of its byte at +0Ah, before it looks at the bitmap. Without that bit it answers nought and changes nothing (`GDI.EXE` 1:1BF3). The bitmap case is reached through the dispatch on the object's kind at 1:1B5F, table at 1:1AEA.
- [[measured]] A region is selected as [[fn:GDI.SelectClipRgn]] selects it. The answer is the kind of region the clip becomes ([[probe:selrgn]]).
- [[measured]] A memory context's first bitmap is the one stock bitmap, a single handle for every memory context ([[probe:stockdel]]). See [[fn:GDI.DeleteObject]].
- [[measured]] A bitmap of a shape no device context takes is refused with nought ([[probe:patmono]]). See [[fn:GDI.CreateBitmap]].

## Nuances

- Four Seasons' Visual Basic picture boxes select a memory context's first bitmap into the context [[fn:USER.BeginPaint]] gave them, select the answer back, and then draw their card with [[fn:GDI.StretchDIBits]]. Until [[probe:selbmp]], winbox.js let the paint context take the bitmap. The card was drawn into that bitmap, and the screen kept only the picture box's grey background.
- Not yet measured: a printer's context and a metafile's.

## Implementation

Both engines refuse a bitmap for any context that is not a memory context. In the TypeScript engine that is a surface without `memoryContext` (`src/win16/gdi/SelectObject.ts`); in the Rust engine a `Dc` without `memory` (`crates/winbox-win16/src/gdi/bitmaps.rs`). A WinG context is a memory context in both.

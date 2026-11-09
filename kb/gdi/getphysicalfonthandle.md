---
kind: function
module: GDI
name: GetPhysicalFontHandle
ordinal: 352
summary: Answers the handle of the font GDI realized for a device context -- the global block its FONTINFO is in, not the logical font selected.
versions:
  '3.1': exact
probes: [gdimisc, prtteng]
records: [physfont, GetPhysicalFontHandle]
source: crates/winbox-win16/src/gdi/physical_font.rs
topics: [small-queries, printer-drivers]
---

## Observed behaviour

- [[measured]] A new memory device context answers a handle; once Arial is selected and drawn with, another ([[probe:gdimisc]]).
- [[measured]] On a printer's context it is the global handle of the block holding the `FONTINFO` the driver realized the font into: [[probe:prtteng]]'s driver finds it is `GlobalHandle` of the `FONTINFO` its `RealizeObject` was given, for each of four TrueType fonts.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `0a2e`: no handle is checked. The answer is the word at 28h of the device context, the realized font's handle.

[[read out]] Realizing a font for a context sets three fields together (seg1 `4094`-`4170`). 3Ah is the far pointer to its `FONTINFO`, 28h the handle of the global block it is in, and 3Eh its entry in GDI's table of realized fonts, 34h bytes each (`[0370h]`), whose word at 0Ah counts the contexts using it. The handle that was there is unlocked; its entry is counted down, and an entry no context uses, but for the stock one at `[037Eh]`, is made discardable (`GlobalReAlloc` with 180h). The new block is locked and, the first time, wired and page-locked (`4145`-`4167`).

## Implementation

`src/win16/gdi/physical-font.ts` and `crates/winbox-win16/src/gdi/physical_font.rs`.

- A printer's context answers the block of the `FONTINFO` its driver realized, from the table of fonts realized for its device ([[topic:printer-drivers]]). This is GDI's own object: the block it allocated, 42h bytes more than the driver asked for. Where the font selected has not yet been realized for the device, nought.
- A display's fonts are realized by WinBox without a `FONTINFO` in memory. So WinBox keeps a block for each font object the first time its physical font is asked for. It is 96h bytes, as GDI keeps a TrueType font's, or a font file's header's 76h for the others, moveable, zeroed and shared. Contexts that select the same font object answer the same block.

## Not yet done

- A display's block holds nothing a program should read: the `FONTINFO` of the font WinBox realized is not laid out in it.
- The display's blocks are made when asked for, not as a font is realized, and kept while WinBox runs. GDI's counts of the contexts using each are not kept.

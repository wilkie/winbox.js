---
kind: function
module: COMMDLG
name: LoadAlterBitmap
ordinal: 9
summary: Loads one of COMMDLG's own bitmaps with one colour of its table made another — how the file dialogs' folders and drives take the window's and highlight's colours.
versions:
  '3.1': stub
topics: [common-dialogs, file-dialogs]
---

## Observed behaviour

COMMDLG calls it for itself: [[fn:COMMDLG.Ordinal 42]] loads bitmap 576 twice with it, pure blue made the window's colour and then the highlight's ([[topic:file-dialogs]]). Not yet measured: no probe calls it.

- [[read out]] The arguments, as pushed: the bitmap's id, a word; the colour to replace, a `COLORREF`; the colour to put in its place, a `COLORREF`. It pops 10 bytes (`COMMDLG.DLL` seg6 `0000`, `retf 0Ah`).
- [[read out]] The bitmap is COMMDLG's own: `FindResource` on COMMDLG's instance, type `RT_BITMAP`, and `LoadResource`; either failing answers nought.
- [[read out]] Both colours are turned from `COLORREF`'s order, red in the low byte, to an `RGBQUAD`'s, blue in the low byte (seg6 `0138`). The resource is locked, and its colour table, after the header of the size its first word gives, is searched four bytes at a time from its first entry: the first entry equal to the colour to replace is overwritten with the other, and the search stops.
- [[read out]] Then, with `GetDC(0)`, the bitmap is made with `CreateDIBitmap(dc, header, CBM_INIT, bits, header, DIB_RGB_COLORS)`, the bits found after the header and 4 × 2^`biBitCount` bytes of colour table. The screen's context is released, the resource unlocked and freed.
- [[read out]] It answers the bitmap, a device-dependent bitmap of the screen's format, or nought.

## Nuances

- [[read out]] The search has no end but a match: a colour the table does not have is looked for past the table's end, through the bits.
- [[read out]] The colour is changed in the resource's own memory, which `FreeResource` then lets go, not a copy. Not yet measured: what a second call finds where the resource stays in memory between calls, as [[fn:COMMDLG.Ordinal 42]]'s two calls for bitmap 576 both look for pure blue.
- [[read out]] The header's size is read as one word, the low word of `biSize`.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg6 `0000` to `0137`, with the colour helper at seg6 `0138`. Its callers are seg2 `0e0e` and `0ed3`.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/commdlg/index.ts`, popping 10 bytes), with no arm in `crates/winbox-win16/src/commdlg/mod.rs`. WinBox's file dialogs make the same pictures from the file's bitmap 576 read as data, the first entry of pure blue replaced (`pictures.ts`, `pictures.rs`), and need no export for it.

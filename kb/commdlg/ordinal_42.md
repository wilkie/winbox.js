---
kind: function
module: COMMDLG
name: Ordinal 42
ordinal: 42
summary: Makes the file dialogs' folders' and drives' pictures: bitmap 576 twice side by side, its blue made the window's colour and then the highlight's.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg2 `0d58` (`retf`), no arguments, answering 1 when the pictures are ready and nought when not.
- [[read out]] If the pictures exist (`[0058h]`) and the window's and highlight's colours they were made for (`[0042h]`, `[0046h]`) are those COMMDLG last read (`[002Eh]`, `[0032h]`, `GetSysColor` of `COLOR_WINDOW` and `COLOR_HIGHLIGHT`, seg2 `0f54`), they are selected into COMMDLG's memory device context again and it answers 1.
- [[read out]] Otherwise the old pictures go (seg2 `0d19`), the colours are kept, and with a compatible device context it calls [[fn:COMMDLG.LoadAlterBitmap]] for bitmap 576 with pure blue (`00FF0000h` as a `COLORREF`) made the window's colour; reads the bitmap's width and height with `GetObject`; makes a discardable bitmap twice as wide; copies the first at x 0; loads 576 again with blue made the highlight's colour and copies it at x = the width, both with `SRCCOPY`. The new bitmap is given to COMMDLG with [[fn:COMMDLG.Ordinal 43]].
- [[read out]] Callers: the file dialogs' first use (seg2 `0fd4`), `WM_SYSCOLORCHANGE` (seg2 `43f1`, `460a`).

## Nuances

- [[read out]] Bitmap 576 is 128 × 16 pixels, 16 colours: the folders' and drives' pictures side by side ([[topic:file-dialogs]]).
- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg2 `0d58` to `0f53`.

## Implementation

Not WinBox's own: ordinal 42 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's. WinBox's file dialogs make the same strip from the file's bitmap read as data (`pictures.ts`, `pictures.rs`): blue made the window's colour, then the highlight's; with no `COMMDLG.DLL` on the drive there are no pictures.

---
kind: function
module: COMMDLG
name: Ordinal 37
ordinal: 37
summary: What the file dialogs free as COMMDLG is let go: the folders' and drives' pictures, and COMMDLG's memory device context.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg2 `54ee`: through seg2 `0d19`, if a bitmap had been selected out of COMMDLG's memory device context (`[02D2h]`) it is selected back, and the pictures' bitmap (`[0058h]`) deleted; then the memory device context the entry point made (`[02D0h]`, [[fn:COMMDLG.Ordinal 53]]) is deleted with `DeleteDC`. It takes nothing and answers nothing.
- [[read out]] [[fn:COMMDLG.WEP]] calls it first of five (seg6 `01c2`).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg2 `54ee`, with seg2 `0d19`, which [[fn:COMMDLG.Ordinal 42]] also calls before it makes the pictures again.

## Implementation

Not WinBox's own: ordinal 37 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's. WinBox's file dialogs keep their pictures as device bitmaps of their own (`pictures.ts`, `pictures.rs`), and make no memory device context as COMMDLG loads.

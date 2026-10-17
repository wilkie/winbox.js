---
kind: function
module: COMMDLG
name: Ordinal 44
ordinal: 44
summary: The current drive, from DOS's function 19h: nought for A.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2c1d` (`retf`): DOS function 19h, its answer in AL with AH cleared: 0 is A, 1 B, and so on.
- [[read out]] Callers: the file dialogs' `WM_INITDIALOG` (seg2 `1818`), the folders and drives (seg2 `2172`, `267f`, `3ea3`, `4cdf`, `534d`, `53a3`, `53ed`).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2c1d`.

## Implementation

Not WinBox's own: ordinal 44 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

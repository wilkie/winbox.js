---
kind: function
module: COMMDLG
name: Ordinal 47
ordinal: 47
summary: Makes a temporary file in a folder with DOS's function 5Ah: its handle, or 80h in the high byte with DOS's error.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2e60` (`retf 4`): one far pointer, the folder's path. DOS function 5Ah with AL and CX nought, normal attributes; it answers AX, the handle, or on a carry AX with its high byte 80h.
- [[read out]] Caller: Save As's check that a file can be made in the folder chosen (seg2 `2298`), which deletes the file again ([[topic:file-dialogs]]).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2e60`.

## Implementation

Not WinBox's own: ordinal 47 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 4 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

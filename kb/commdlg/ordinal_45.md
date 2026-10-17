---
kind: function
module: COMMDLG
name: Ordinal 45
ordinal: 45
summary: A file's attributes from DOS's function 4300h, or 80h in the high byte with DOS's error.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2e1b` (`retf 4`): one far pointer, the path. DOS function 43h with AL 0; it answers CX, the attributes, or, on a carry, AX with its high byte 80h.
- [[read out]] Callers: the file dialogs' OK (seg2 `1f2b`, `2b04`).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2e1b`.

## Implementation

Not WinBox's own: ordinal 45 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 4 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

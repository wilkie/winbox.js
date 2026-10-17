---
kind: function
module: COMMDLG
name: Ordinal 40
ordinal: 40
summary: Puts back the disk transfer area Ordinal 39 kept.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2d21` (`retf`): DOS function 1Ah with DS:DX the far pointer kept at `[027Eh]` by [[fn:COMMDLG.Ordinal 39]] or [[fn:COMMDLG.Ordinal 49]]. It takes nothing and answers nothing.
- [[read out]] Caller: seg2 `0738`, as the lists are done.

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2d21`.

## Implementation

Not WinBox's own: ordinal 40 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

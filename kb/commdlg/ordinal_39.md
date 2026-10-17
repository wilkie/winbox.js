---
kind: function
module: COMMDLG
name: Ordinal 39
ordinal: 39
summary: Sets DOS's disk transfer area for the file dialogs' searches, keeping the old one to put back.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2cf1` (`retf 4`): one far pointer. DOS function 2Fh's answer, the disk transfer area as it was, is kept at `[027Eh]`; then function 1Ah makes the pointer the area. It answers nothing.
- [[read out]] [[fn:COMMDLG.Ordinal 40]] puts the kept area back. Callers: seg2 `04ec`, `5385`.

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2cf1`.

## Implementation

Not WinBox's own: ordinal 39 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 4 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

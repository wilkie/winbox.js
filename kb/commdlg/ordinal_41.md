---
kind: function
module: COMMDLG
name: Ordinal 41
ordinal: 41
summary: DOS's Find Next File (function 4Fh) for the file dialogs: nought or DOS's error.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2d6f` (`retf`): `DOS3Call` with AX 4F00h, carry cleared first; it answers nought, or DOS's error on a carry. The search is the one [[fn:COMMDLG.Ordinal 38]] began, in the area [[fn:COMMDLG.Ordinal 39]] set.
- [[read out]] Caller: seg2 `0615`.

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2d6f`.

## Implementation

Not WinBox's own: ordinal 41 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

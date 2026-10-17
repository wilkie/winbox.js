---
kind: function
module: COMMDLG
name: Ordinal 46
ordinal: 46
summary: DOS's extended error, from function 59h.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2e44` (`retf 4`): DOS function 59h with BX nought, answering AX, the extended error. It pops four bytes of arguments it never reads.
- [[read out]] Caller: Save As's check that a file can be made in a folder (seg2 `22cf`, after [[fn:COMMDLG.Ordinal 47]] fails; [[topic:file-dialogs]]).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2e44`.

## Implementation

Not WinBox's own: ordinal 46 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 4 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

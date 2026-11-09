---
kind: function
module: COMMDLG
name: Ordinal 52
ordinal: 52
summary: Changes the current directory with DOS's function 3Bh: nought or DOS's error.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2c5c` (`retf 4`): one far pointer, the path, given to DOS function 3Bh. It answers nought, or DOS's error on a carry.
- [[read out]] Caller: seg2 `546e`, as a file dialog goes into a folder ([[topic:file-dialogs]]).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2c5c`.

## Implementation

Not WinBox's own: ordinal 52 is it has no arm in WinBox (`crates/winbox-win16/src/commdlg/mod.rs`); the entry's `retf` pops 4 bytes. With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

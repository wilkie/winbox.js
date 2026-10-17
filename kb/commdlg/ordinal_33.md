---
kind: function
module: COMMDLG
name: Ordinal 33
ordinal: 33
summary: What Find and Replace free as COMMDLG is let go: nothing — an empty function WEP calls.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg5 `0b2e` sets up its frame and returns (`retf`): it takes nothing, does nothing and answers nothing.
- [[read out]] [[fn:COMMDLG.WEP]] calls it last of five, one for each dialog's segment (seg6 `01d6`). Find and Replace keep nothing of their own past a dialog's end, so theirs is empty.

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg5 `0b2e`, the last function of the Find and Replace segment.

## Implementation

Not WinBox's own: ordinal 33 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

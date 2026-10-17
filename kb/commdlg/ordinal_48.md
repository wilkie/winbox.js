---
kind: function
module: COMMDLG
name: Ordinal 48
ordinal: 48
summary: Copies bytes between far addresses, safely where the two overlap.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2ba4` (`retf 0Ah`): a far destination, a far source and a count, pushed in that order. Where the source's offset is above the destination's it copies forwards, words then the odd byte; otherwise backwards from the end, the odd byte first. It answers nothing.
- [[read out]] Caller: the file dialogs (seg2 `31e4`).

## Nuances

- [[read out]] The function after it, seg1 `2bef`, fills bytes with one value (`rep stosw`); it has no entry.
- [[read out]] The test compares offsets only, as within one segment.
- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2ba4`.

## Implementation

Not WinBox's own: ordinal 48 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 10 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

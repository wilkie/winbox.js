---
kind: function
module: COMMDLG
name: Ordinal 50
ordinal: 50
summary: Selects the current drive with DOS's function 0Eh.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2c37` (`retf 2`): one word, the drive (0 for A), given to DOS function 0Eh. It answers nought unless DOS sets the carry, which function 0Eh does not do.
- [[read out]] Callers: the drives (seg2 `5368`, `53d1`, `54ae`).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2c37`.

## Implementation

Not WinBox's own: ordinal 50 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 2 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

---
kind: function
module: COMMDLG
name: Ordinal 51
ordinal: 51
summary: The current directory as a whole path, from DOS's functions 19h and 47h, into a buffer of a given size.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2c83` (`retf 6`): a far pointer to the buffer and its size.
- [[read out]] A size below 4 fails at once. Otherwise, on its own stack, it writes the current drive's letter (DOS 19h plus `A`), `:\`, and DOS function 47h's path for the current drive, ended with a nought at 64 characters, and copies exactly the size given into the buffer. It answers nought.
- [[read out]] Failing, it answers DOS function 59h's extended error.
- [[read out]] Caller: seg2 `54d2`.

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2c83`.

## Implementation

Not WinBox's own: ordinal 51 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 6 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.

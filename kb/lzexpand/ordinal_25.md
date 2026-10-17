---
kind: function
module: LZEXPAND
name: Ordinal 25
ordinal: 25
summary: A file's time and date given to another, by the C library's _dos_getftime and _dos_setftime.
versions:
  '3.1': stub
topics: [compressed-files]
---

## Observed behaviour

- [[read out]] `LZEXPAND.DLL` seg10 `02a8`: -1 where the first fails, -2 the second. Its arguments are a C function's: the caller pops them.
- [[read out]] The entry table gives it flags 0: it is an entry for LZEXPAND's own far calls into a moveable segment, not a function LZEXPAND offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/lzexpand/index.ts`, named `Unknown`), with no arm in `crates/winbox-win16/src/lzexpand/mod.rs`. WinBox's own LZEXPAND does what it does where LZEXPAND does it, in its own code ([[topic:compressed-files]]).

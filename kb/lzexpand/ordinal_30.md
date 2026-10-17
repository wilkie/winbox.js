---
kind: function
module: LZEXPAND
name: Ordinal 30
ordinal: 30
summary: The C library's own, from its start and end.
versions:
  '3.1': stub
topics: [compressed-files]
---

## Observed behaviour

- [[read out]] `LZEXPAND.DLL` seg11 `034e`; no export reaches it. Its arguments are a C function's: the caller pops them.
- [[read out]] The entry table gives it flags 0: it is an entry for LZEXPAND's own far calls into a moveable segment, not a function LZEXPAND offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/lzexpand/index.ts`, named `Unknown`), with no arm in `crates/winbox-win16/src/lzexpand/mod.rs`. WinBox's own LZEXPAND does what it does where LZEXPAND does it, in its own code ([[topic:compressed-files]]).

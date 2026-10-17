---
kind: function
module: LZEXPAND
name: Ordinal 15
ordinal: 15
summary: Whether a header's signature is COMPRESS's, by USER's lstrcmp of its eight bytes and a nought with the copy at [0060h].
versions:
  '3.1': stub
topics: [compressed-files]
---

## Observed behaviour

- [[read out]] `LZEXPAND.DLL` seg8 `01a2`: 1 where they are the same, else nought. Its arguments are a C function's: the caller pops them.
- [[read out]] The entry table gives it flags 0: it is an entry for LZEXPAND's own far calls into a moveable segment, not a function LZEXPAND offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/lzexpand/index.ts`, named `Unknown`), with no arm in `crates/winbox-win16/src/lzexpand/mod.rs`. WinBox's own LZEXPAND does what it does where LZEXPAND does it, in its own code ([[topic:compressed-files]]).

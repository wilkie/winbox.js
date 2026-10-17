---
kind: function
module: LZEXPAND
name: Ordinal 20
ordinal: 20
summary: The decoder -- the stream expanded into a file or the window until more than a limit is made or the input ends, begun again from byte 14 where asked.
versions:
  '3.1': stub
topics: [compressed-files]
---

## Observed behaviour

- [[read out]] `LZEXPAND.DLL` seg9 `0000` ([[format:szdd]]). Its arguments are a C function's: the caller pops them.
- [[read out]] The entry table gives it flags 0: it is an entry for LZEXPAND's own far calls into a moveable segment, not a function LZEXPAND offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/lzexpand/index.ts`, named `Unknown`), with no arm in `crates/winbox-win16/src/lzexpand/mod.rs`. WinBox's own LZEXPAND does what it does where LZEXPAND does it, in its own code ([[topic:compressed-files]]).

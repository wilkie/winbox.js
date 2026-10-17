---
kind: function
module: VER
name: Ordinal 15
ordinal: 15
summary: VER's call into Win32s for a file's memory — W32SYS.DLL's ordinal 7, where it could be loaded.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg4 `008a`: as [[fn:VER.Ordinal 14]], with Win32s's ordinal 7; nought where it cannot be loaded, popping 2 bytes.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 2 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.

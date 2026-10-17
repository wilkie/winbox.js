---
kind: function
module: VER
name: Ordinal 16
ordinal: 16
summary: VER's call into Win32s to open a file that is no Windows 3.1 program — W32SYS.DLL's ordinal 2, where it could be loaded.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg4 `003e`: as [[fn:VER.Ordinal 14]], with Win32s's ordinal 2; nought where it cannot be loaded, popping 6 bytes. [[fn:VER.GetFileResourceSize]] and [[fn:VER.GetFileResource]] call it where a file is not one.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 6 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.

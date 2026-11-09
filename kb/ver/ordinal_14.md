---
kind: function
module: VER
name: Ordinal 14
ordinal: 14
summary: VER's call into Win32s for a resource's bytes — W32SYS.DLL's ordinal 6, where it could be loaded.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg4 `00d6`: the Win32s library loaded once (seg4 `000b`, `LoadLibrary("w32sys.dll")` with `SetErrorMode(8000h)`), and where it is, its ordinal 6 found and jumped to with the caller's arguments; otherwise nought, popping 14 bytes.
- [[read out]] [[fn:VER.GetFileResource]] calls it for a file that is no Windows 3.1 program. No Win32s is installed; WinBox does not load it.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: no arm in `crates/winbox-win16/src/ver/mod.rs`; the entry pops 14 bytes. WinBox's own VER does what it does where VER does it, in its own code.

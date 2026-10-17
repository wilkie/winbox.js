---
kind: function
module: VER
name: Ordinal 18
ordinal: 18
summary: Whether a file is in use — GetModuleHandle of its name, and that module's file the path.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg3 `113a`, popping 8 bytes: `GetModuleHandle` of the name; a handle above 1 has its file asked for with `GetModuleFileName`, and it is in use where `lstrcmpi` finds that file the path. [[fn:VER.VerFindFile]] and [[fn:VER.VerInstallFile]] ask it.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 8 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.

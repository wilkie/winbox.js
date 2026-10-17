---
kind: function
module: VER
name: Ordinal 13
ordinal: 13
summary: A long shifted left — DX:AX shifted by CL, VER's own helper for a resource's place and length.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg3 `1614`: `shl ax, 1; rcl dx, 1`, CL times. Its arguments are in registers; it pops nothing.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 0 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.

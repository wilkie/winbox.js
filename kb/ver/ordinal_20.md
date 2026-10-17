---
kind: function
module: VER
name: Ordinal 20
ordinal: 20
summary: VER's second data segment again, as an entry at its offset 16h.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] An entry of seg5, offset 16h, loaded into DS by seg4 `008e` and `00da`.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 0 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.

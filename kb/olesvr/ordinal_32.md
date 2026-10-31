---
kind: function
module: OLESVR
name: Ordinal 32
ordinal: 32
summary: "An entry of `OLESVR.DLL`'s with no name: one of its own far calls, not a function it offers programs."
versions:
  '3.1': stub
topics: [ole]
---

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function at this ordinal.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/olesvr/index.ts`, named `Unknown`), with no arm in `crates/winbox-win16/src/olesvr/mod.rs`.

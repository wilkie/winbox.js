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
- [[read out]] `OLESVR.DLL` seg3 `0010`: an exported far procedure popping ten bytes, as a timer's procedure is; `OLESVR.DLL` imports `SetTimer` once. Neither the timer nor what it does is measured; WinBox's sets none.

## Implementation

Not WinBox's own: a stub in WinBox's table (`crates/winbox-win16/src/kept.rs`, named `Unknown`), with no arm in `crates/winbox-win16/src/olesvr/mod.rs`.

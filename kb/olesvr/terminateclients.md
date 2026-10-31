---
kind: function
module: OLESVR
name: TERMINATECLIENTS
ordinal: 27
summary: "One of `OLESVR.DLL`'s own procedures, handed to USER to enumerate its windows or their properties: not a function it offers programs."
versions:
  '3.1': stub
topics: [ole]
---

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `TERMINATECLIENTS`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do (`OLESVR.DLL`'s calls, as WinBox runs it, include both).

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/olesvr/index.ts`), with no arm in `crates/winbox-win16/src/olesvr/mod.rs`. WinBox's `OLESVR` keeps what the file keeps on its windows beside guest memory ([[topic:ole]]).

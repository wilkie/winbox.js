---
kind: function
module: OLECLI
name: LESHOW
ordinal: 201
summary: "An embedded or linked object's `Show` method, which its table holds."
versions:
  '3.1': unrecorded
source: src/win16/olecli/linked.ts
topics: [ole]
---

## Observed behaviour

- [[inferred]] Not measured: `OLE_ERROR_GENERIC` ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

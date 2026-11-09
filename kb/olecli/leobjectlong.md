---
kind: function
module: OLECLI
name: LEOBJECTLONG
ordinal: 229
summary: "An embedded or linked object's `ObjectLong` method, which its table holds."
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[inferred]] Not measured: `OLE_ERROR_GENERIC` ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

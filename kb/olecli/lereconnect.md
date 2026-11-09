---
kind: function
module: OLECLI
name: LERECONNECT
ordinal: 219
summary: "An embedded or linked object's `Reconnect` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: A link not open connected to a server that has its document, launching none: advised, its item asked for, released `OLE_RECONNECT`; none answering, `OLE_OK`.

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

---
kind: function
module: OLECLI
name: LEEXECUTE
ordinal: 228
summary: "An embedded or linked object's `Execute` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Open: a copy of the commands executed on its document, released `OLE_OTHER`; not open `OLE_ERROR_NOT_OPEN`.

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

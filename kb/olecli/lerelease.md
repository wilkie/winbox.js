---
kind: function
module: OLECLI
name: LERELEASE
ordinal: 200
summary: "An embedded or linked object's `Release and Delete` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Not open: let go at once, `OLE_OK`. Open: `[StdCloseDocument]`, the document's conversation ended, then `System`'s (a link's alone), its client told `OLE_RELEASE` with `OLE_DELETE`, then let go; `OLE_WAIT_FOR_RELEASE`. Busy: `OLE_BUSY`.

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

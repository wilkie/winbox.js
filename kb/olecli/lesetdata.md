---
kind: function
module: OLECLI
name: LESETDATA
ordinal: 203
summary: "An embedded or linked object's `SetData` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: `Native` copied in and its client told `OLE_CHANGED` at once; open, poked as the item nought, released `OLE_SETDATA`.

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

---
kind: function
module: OLECLI
name: LECLOSE
ordinal: 225
summary: "An embedded or linked object's `Close` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: src/win16/olecli/linked.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Not open: `OLE_OK`. Open: `[StdCloseDocument]` and its conversations ended (a link's one), released `OLE_CLOSE`.

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

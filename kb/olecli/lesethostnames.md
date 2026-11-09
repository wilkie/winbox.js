---
kind: function
module: OLECLI
name: LESETHOSTNAMES
ordinal: 204
summary: "An embedded or linked object's `SetHostNames` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: The names kept, after two word offsets to them; open, poked as `StdHostNames` in `Binary`, released `OLE_OTHER`; else poked as the object is next opened.

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

---
kind: function
module: OLECLI
name: LESETBOUNDS
ordinal: 206
summary: "An embedded or linked object's `SetBounds` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Its width and height, twice, kept; open, poked as `StdDocDimensions` (`0,0,1500,-750` as 1500, 750, 1500, 750), released `OLE_OTHER`.

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

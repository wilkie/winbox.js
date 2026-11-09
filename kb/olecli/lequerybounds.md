---
kind: function
module: OLECLI
name: LEQUERYBOUNDS
ordinal: 213
summary: "An embedded or linked object's `QueryBounds` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Its presentation's, or a Paintbrush object's bitmap's at its pixels to a metre; none `OLE_ERROR_BLANK`, noughts written.

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

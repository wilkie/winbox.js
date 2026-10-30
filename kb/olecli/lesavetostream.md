---
kind: function
module: OLECLI
name: LESAVETOSTREAM
ordinal: 207
summary: "An embedded or linked object's `SaveToStream` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: src/win16/olecli/linked.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: 0501h, the type, the class, the document and item (an embedded object's document none), `Native` or a link's network name, nought and update option, then its presentation as a static object's of type 5, or 0501h and nought; a Paintbrush object's none.

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

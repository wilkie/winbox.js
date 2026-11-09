---
kind: function
module: OLECLI
name: LEUPDATE
ordinal: 218
summary: "An embedded or linked object's `Update` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Open: `Native` and a picture asked for (a Paintbrush object's `Native` alone; a link's item), its client told `OLE_CHANGED`, released `OLE_UPDATE`. Not open: `OLE_OK` (not measured).

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

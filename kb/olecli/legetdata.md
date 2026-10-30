---
kind: function
module: OLECLI
name: LEGETDATA
ordinal: 202
summary: "An embedded or linked object's `GetData` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: src/win16/olecli/linked.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: `Native` where it has some, else `OLE_ERROR_FORMAT`; `OwnerLink` (a link's `ObjectLink`) made of its class, document and item; its presentation's format; a picture where it has none, an empty `METAFILEPICT`. A Paintbrush object's picture is made for the caller from its bitmap, `OLE_WARN_DELETE_DATA`, and `OLE_ERROR_MEMORY` with no bitmap.

## Implementation

WinBox's own: `linked.ts`'s `LE_METHODS` and `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").

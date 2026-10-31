---
kind: function
module: OLESVR
name: OleSavedServerDoc
ordinal: 10
summary: "A document saved: each object's `/Save` advises sent."
versions:
  '3.1': exact
probes: [olesrv]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: for each object in the order given, its data is asked for in each format advised and sent to each conversation that advised the object for `/Save`, as [[fn:OLESVR.ITEMCALLBACK]] does for `OLE_SAVED`; then `OLE_OK`. Nought, `OLE_ERROR_HANDLE`.

## Implementation

WinBox's own: `savedServerDoc` in `src/win16/olesvr/server.ts` and `saved_server_doc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

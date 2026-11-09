---
kind: function
module: OLESVR
name: OleRegisterServerDoc
ordinal: 6
summary: "A document the server opened itself registered: a window of `DocWndClass`, child of the server's, whose handle is the `LHSERVERDOC`."
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `OLE_OK`, a handle written; the document's name is the topic a client initiates on, answered from the document's window, a `DocWndClass` child of the server's `SrvrWndClass`. The document's own methods are then called as a document made through the system topic's are.
- [[measured]] [[probe:olesrv]]: a server handle of nought, `OLE_ERROR_HANDLE`, nothing written.

## Implementation

WinBox's own: `registerServerDoc` in `src/win16/olesvr/server.ts` and `register_server_doc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

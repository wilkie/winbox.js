---
kind: function
module: OLESVR
name: OleRevokeServerDoc
ordinal: 7
summary: 'A document revoked: its objects released, its conversations ended, its `Release` called once the last ends.'
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: each object's `Release`, in the order the objects were given; then each conversation is sent `WM_DDE_TERMINATE` and the answer is `OLE_WAIT_FOR_RELEASE`, the document's `Release` called as the client answers; with no conversation, its `Release` before it returns and `OLE_OK`.
- [[measured]] [[probe:olesrv]]: called from the document's `Close` (as `StdCloseDocument` asks), `OLE_WAIT_FOR_RELEASE`. Nought, or a document already gone, `OLE_ERROR_HANDLE`.

## Implementation

WinBox's own: `revoke_server_doc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). WinBox agrees with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`crates/winbox-win16/tests/olesvr.rs`).

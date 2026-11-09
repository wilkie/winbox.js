---
kind: function
module: OLESVR
name: OleRenameServerDoc
ordinal: 8
summary: 'A document renamed: its new name sent to each conversation that advised `StdDocumentName`.'
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `OLE_OK`; a conversation that advised `StdDocumentName` is sent `WM_DDE_DATA` of that item in `Binary` -- the format it advised is not used -- the new name and its nought, flags 2000h (the client to free it, no acknowledgement asked). No method of the server's is called.
- [[measured]] [[probe:olesrv]]: nought, `OLE_ERROR_HANDLE`.
- [[inferred]] The document is known by its new name to later initiates.

## Implementation

WinBox's own: `renameServerDoc` in `src/win16/olesvr/server.ts` and `rename_server_doc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

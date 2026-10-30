---
kind: function
module: OLESVR
name: ITEMCALLBACK
ordinal: 26
summary: 'The `CallBack` of the `OLECLIENT` OLESVR gives each object: what the server tells of the object sent to the conversations that advised it.'
versions:
  '3.1': exact
probes: [olesrv]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `OLE_CHANGED` asks the object's data in every format the conversation advised and sends each as the item, `WM_DDE_DATA` flags 2000h (no `fAckReq`, whatever the advise asked); `OLE_SAVED` the same as `item/Save`, in every format advised -- an item advised for a change in two formats and for a save in one is sent in both. Nothing where the conversation did not advise that time. The target device poked is given first.
- [[measured]] [[probe:olesrv]]: `OLE_CLOSED` of an object nothing advised for `/Close`, nothing.
- [[measured]] [[probe:olesrv]]: `OLE_RENAMED` asks the object's formats until `ObjectLink`, its `ObjectLink`, and sends the document named in it to each conversation that advised `StdDocumentName`, as [[fn:OLESVR.OleRenameServerDoc]] sends it.
- [[measured]] [[probe:olesrv]]: the answer is nought. Once [[fn:OLESVR.OleRevokeObject]] has revoked the object, its client is not called.

## Implementation

WinBox's own: `itemCallback` in `src/win16/olesvr/server.ts` and `item_callback` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

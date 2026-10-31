---
kind: function
module: OLESVR
name: OleRegisterServer
ordinal: 2
summary: 'A server registered for its class: a hidden window of `SrvrWndClass` made, whose handle is the `LHSERVER`.'
versions:
  '3.1': partial
probes: [olesrv]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: a class the registration database has is registered, `OLE_OK`, a handle written; one it has not, `OLE_ERROR_CLASS` (20), the handle left as it was.
- [[measured]] [[probe:olesrv]]: each registration makes a hidden top-level window of `SrvrWndClass`, the calling task's (`EnumTaskWindows` finds it, newest first). The same class registered twice is two servers, and both windows answer an initiate on the class.
- [[measured]] [[probe:olesrv]]: the server's window answers `WM_DDE_INITIATE` on its class and `OLEsystem`, never `System`, and a document's name from the document's window. A server registered `OLE_SERVER_MULTI` that has a document answers no initiate on `OLEsystem` and refuses every command that would make another: one instance, one document. One registered `OLE_SERVER_SINGLE` takes every document it is asked to make.
- [[documented]] The `OLESERVER` passed is the server's own, its table's seven methods called as clients ask: `Open`, `Create`, `CreateFromTemplate`, `Edit`, `Exit`, `Release`, `Execute`.

## Nuances

- `unrecorded`: a NULL class, server or out pointer; a class registered as another task's.
- [[measured]] As WinBox ran `OLESVR.DLL` from the drive, its entry added 21 atoms (the protocol's commands, `System`, `OLEsystem`, `StdDocumentName`, `Protocols`, `Topics`, `Formats`, `Status`, `EditEnvItems`, `True`, `False`, `Change`, `Save`, `Close`), registered `Native`, `Binary`, `ObjectLink` and `OwnerLink`, and three classes, `SrvrWndClass`, `DocWndClass` (eight bytes of window words each) and `ItemWndClass` (four). WinBox's does the same as a program first calls it.

## Implementation

WinBox's own: `registerServer` in `src/win16/olesvr/server.ts` and `register_server` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

---
kind: function
module: OLESVR
name: OleRevokeObject
ordinal: 11
summary: 'An object revoked by its client: its `Release` called and the conversations it was given in ended.'
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: the object's `Release`, then `OLE_OK`, and the document's conversation the object was given in is sent `WM_DDE_TERMINATE` -- the whole conversation, not only the object's advises. Its client's `CallBack` is no longer one to call.
- [[measured]] [[probe:olesrv]]: NULL, `OLE_ERROR_ADDRESS` (16).
- `unrecorded`: a pointer that is not an `OLECLIENT` OLESVR gave; WinBox answers `OLE_ERROR_ADDRESS`.

## Implementation

WinBox's own: `revoke_object` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). WinBox agrees with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`crates/winbox-win16/tests/olesvr.rs`).

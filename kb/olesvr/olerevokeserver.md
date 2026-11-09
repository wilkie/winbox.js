---
kind: function
module: OLESVR
name: OleRevokeServer
ordinal: 3
summary: 'A server revoked: its documents revoked, its conversations ended, its `Release` called once the last ends.'
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: each document is revoked in the order it was made -- its objects' `Release` in the order they were given, then the document's `Release` where no conversation is left on it -- then each system conversation is sent `WM_DDE_TERMINATE`. With conversations, `OLE_WAIT_FOR_RELEASE` (1), and the server's `Release` is called as the client answers the last terminate; with none, the `Release` is called before it returns, `OLE_OK`.
- [[measured]] [[probe:olesrv]]: nought, `OLE_ERROR_HANDLE` (18).

## Implementation

WinBox's own: `revoke_server` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). WinBox agrees with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`crates/winbox-win16/tests/olesvr.rs`).

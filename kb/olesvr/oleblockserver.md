---
kind: function
module: OLESVR
name: OleBlockServer
ordinal: 4
summary: "A server's clients' messages queued, not handled, until it unblocks."
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `OLE_OK`; an execute posted to the server after it is not handled -- no method called, no acknowledgement -- until [[fn:OLESVR.OleUnblockServer]]. Nought, `OLE_ERROR_HANDLE`.
- [[inferred]] Its documents' messages are queued with the server's: WinBox queues both, in the order posted.

## Implementation

WinBox's own: `block_server` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). WinBox agrees with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`crates/winbox-win16/tests/olesvr.rs`).

---
kind: function
module: OLESVR
name: OleUnblockServer
ordinal: 5
summary: "The first message a blocked server's clients sent handled; whether more wait."
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: with one execute queued, the server's `Execute` is called, it is acknowledged, and the answer is `OLE_OK` with nought written for more. A message posted after is handled at once: with the queue empty the server is no longer blocked.
- [[measured]] [[probe:olesrv]]: nought, `OLE_ERROR_HANDLE`, the flag left as it was.

## Implementation

WinBox's own: `unblockServer` in `src/win16/olesvr/server.ts` and `unblock_server` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

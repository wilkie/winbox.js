---
kind: function
module: OLESVR
name: OleRevertServerDoc
ordinal: 9
summary: 'A document reverted to its saved state: nothing sent.'
versions:
  '3.1': exact
probes: [olesrv]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `OLE_OK`, and nothing on the wire. Nought, `OLE_ERROR_HANDLE`.

## Implementation

WinBox's own: `revertServerDoc` in `src/win16/olesvr/server.ts` and `revert_server_doc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

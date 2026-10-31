---
kind: function
module: OLESVR
name: SRVRWNDPROC
ordinal: 21
summary: "The window procedure of `SrvrWndClass`, a server's window: its system conversations and its documents' initiates."
versions:
  '3.1': exact
probes: [olesrv]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `WM_DDE_INITIATE` on the class and `OLEsystem` is answered, from the server's window, with a sent `WM_DDE_ACK` of new atoms of the class and topic; on a document's name, from the document's window. `System`, another class, or a topic it has no document of, nothing.
- [[measured]] [[probe:olesrv]]: on the system topic, `[StdNewDocument("class","doc")]` is the server's `Create`, `[StdEditDocument("doc")]` its `Edit` (with the server's class), `[StdOpenDocument("doc")]` its `Open`, `[StdNewFromTemplate("class","doc","template")]` its `CreateFromTemplate`, each given a new document's handle; acknowledged 8000h where it answers `OLE_OK`, else 0000h. A command with the wrong count of arguments, another `Std` command, or text not in brackets, 0000h with no method called. `[StdExit]` is its `Exit`. Anything else in brackets -- several commands too -- is its `Execute` with the whole block, and acknowledged by its answer. Each acknowledgement hands back the block.
- [[measured]] [[probe:olesrv]]: requests of `Topics`, `Formats` and `Status` are answered in `CF_TEXT`, flags 3000h: `Doc`, `Picture` tab `Bitmap`, and `Ready`, whatever documents there are. `SysItems` is acknowledged 8000h with no data.
- `unrecorded`: `Protocols` and `EditEnvItems`, whose atoms the file adds; WinBox acknowledges them as `SysItems`.

## Implementation

WinBox's own: `srvrWndProc` in `src/win16/olesvr/server.ts` and `srvr_wnd_proc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

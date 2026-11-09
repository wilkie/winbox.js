---
kind: function
module: OLESVR
name: SRVRWNDPROC
ordinal: 21
summary: "The window procedure of `SrvrWndClass`, a server's window: its system conversations and its documents' initiates."
versions:
  '3.1': exact
probes: [olesrv, oleitem]
records:
  [
    ack,
    'ack.initiate',
    advise,
    ask,
    asked,
    CallBack,
    data,
    DELETECLIENTINFO,
    'doc.Close',
    'doc.Execute',
    'doc.GetObject',
    'doc.Release',
    'doc.SetColorScheme',
    'doc.SetDocDimensions',
    'doc.SetHostNames',
    ENUMFORTERMINATE,
    execute,
    FINDITEMWND,
    GetProp,
    initiate,
    initiated,
    item,
    long,
    noanswer,
    'obj.DoVerb',
    'obj.EnumFormats',
    'obj.GetData',
    'obj.Release',
    'obj.SetData',
    'obj.SetTargetDevice',
    'obj.Show',
    OleBlockServer,
    OleQueryServerVersion,
    OleRegisterServer,
    OleRegisterServerDoc,
    OleRenameServerDoc,
    OleRevertServerDoc,
    OleRevokeObject,
    OleRevokeServer,
    OleRevokeServerDoc,
    OleSavedServerDoc,
    OleUnblockServer,
    poke,
    ready,
    RegSetValue,
    request,
    SENDDATAMSG,
    SENDRENAMEMSG,
    server,
    'srv.Create',
    'srv.end',
    'srv.Execute',
    'srv.Exit',
    'srv.Release',
    'srv.start',
    'srv2.Create',
    'srv2.CreateFromTemplate',
    'srv2.Edit',
    'srv2.Open',
    'srv2.Release',
    terminate,
    TERMINATECLIENTS,
    TERMINATEDOCCLIENTS,
    tree,
    unadvise,
    window,
    WinExec,
  ]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: `WM_DDE_INITIATE` on the class and `OLEsystem` is answered, from the server's window, with a sent `WM_DDE_ACK` of new atoms of the class and topic; on a document's name, from the document's window. `System`, another class, or a topic it has no document of, nothing.
- [[measured]] [[probe:oleitem]]: a server registered `OLE_SERVER_MULTI` with a system conversation already answers no second on `OLEsystem`, as it answers none once it has a document. Each conversation it answers is kept as a property of the window that answered, named `@` and the client's window in four hex digits, capitals, its datum the client's window; a client's terminate takes it away. The server's window words are not nought.
- [[measured]] [[probe:oleitem]]: as a client ends the server's last system conversation, with no document's conversation left, the server's `Release` is called, though it stays registered: [[fn:OLESVR.OleRevokeServer]] calls it again. [[read out]] `OLESVR.DLL` seg3 `1024`-`108b`, called as a system conversation ends (`0969`), as a document goes (`1636`) and as a document's conversation ends (`18ce`): not where a document was just made for a client that has yet to begin its conversation.
- [[measured]] [[probe:olesrv]]: on the system topic, `[StdNewDocument("class","doc")]` is the server's `Create`, `[StdEditDocument("doc")]` its `Edit` (with the server's class), `[StdOpenDocument("doc")]` its `Open`, `[StdNewFromTemplate("class","doc","template")]` its `CreateFromTemplate`, each given a new document's handle; acknowledged 8000h where it answers `OLE_OK`, else 0000h. A command with the wrong count of arguments, another `Std` command, or text not in brackets, 0000h with no method called. `[StdExit]` is its `Exit`. Anything else in brackets -- several commands too -- is its `Execute` with the whole block, and acknowledged by its answer. Each acknowledgement hands back the block.
- [[measured]] [[probe:olesrv]]: requests of `Topics`, `Formats` and `Status` are answered in `CF_TEXT`, flags 3000h: `Doc`, `Picture` tab `Bitmap`, and `Ready`, whatever documents there are. `SysItems` is acknowledged 8000h with no data.
- `unrecorded`: `Protocols` and `EditEnvItems`, whose atoms the file adds; WinBox acknowledges them as `SysItems`.

## Implementation

WinBox's own: `srvrWndProc` in `src/win16/olesvr/server.ts` and `srvr_wnd_proc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

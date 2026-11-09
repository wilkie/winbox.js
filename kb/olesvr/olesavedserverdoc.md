---
kind: function
module: OLESVR
name: OleSavedServerDoc
ordinal: 10
summary: "A document saved: each object's `/Save` advises sent."
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

- [[measured]] [[probe:olesrv]]: for each object in the order given, its data is asked for in each format advised and sent to each conversation that advised the object for `/Save`, as [[fn:OLESVR.ITEMCALLBACK]] does for `OLE_SAVED`; then `OLE_OK`. Nought, `OLE_ERROR_HANDLE`.
- [[measured]] [[probe:oleitem]]: an embedded document with objects no client advised for `/Save` answers 52, `OLE_ERROR_CANT_UPDATE_CLIENT`, having sent the others. [[read out]] `OLESVR.DLL` seg3 `14ba`-`1525`: each item window is handed [[fn:OLESVR.FINDITEMWND]] to be told saved, and an embedded document one of whose saves reached no client gives that answer.

## Implementation

WinBox's own: `savedServerDoc` in `src/win16/olesvr/server.ts` and `saved_server_doc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

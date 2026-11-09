---
kind: function
module: OLESVR
name: ITEMCALLBACK
ordinal: 26
summary: 'The `CallBack` of the `OLECLIENT` OLESVR gives each object: what the server tells of the object sent to the conversations that advised it.'
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

- [[measured]] [[probe:olesrv]]: `OLE_CHANGED` asks the object's data in every format the conversation advised and sends each as the item, `WM_DDE_DATA` flags 2000h (no `fAckReq`, whatever the advise asked); `OLE_SAVED` the same as `item/Save`, in every format advised -- an item advised for a change in two formats and for a save in one is sent in both. Nothing where the conversation did not advise that time. The target device poked is given first.
- [[measured]] [[probe:olesrv]]: `OLE_CLOSED` of an object nothing advised for `/Close`, nothing.
- [[measured]] [[probe:olesrv]]: `OLE_RENAMED` asks the object's formats until `ObjectLink`, its `ObjectLink`, and sends the document named in it to each conversation that advised `StdDocumentName`, as [[fn:OLESVR.OleRenameServerDoc]] sends it.
- [[measured]] [[probe:oleitem]]: each client that advised the item is sent in the order of its property on the item's window -- an advise sets it again, last -- native data first where it advised it, then the one other format it advised last, each asked of the object for that client alone. A deferred advise is sent `WM_DDE_DATA` with no block. [[read out]] `OLESVR.DLL` seg3 `2c04`-`2c4e`: the item window's properties are each handed [[fn:OLESVR.SENDDATAMSG]] with the time.
- [[measured]] [[probe:oleitem]]: `OLE_SAVED` of an object of an embedded document (made by `StdNewDocument`, `StdEditDocument` or `StdNewFromTemplate`, not renamed since) that no client advised for `/Save` answers 52, `OLE_ERROR_CANT_UPDATE_CLIENT` (read out, seg3 `2c37`-`2c4e`).
- [[measured]] [[probe:olesrv]]: the answer is otherwise nought. Once [[fn:OLESVR.OleRevokeObject]] has revoked the object, its client is not called.

## Implementation

WinBox's own: `item_callback` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). WinBox agrees with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`crates/winbox-win16/tests/olesvr.rs`).

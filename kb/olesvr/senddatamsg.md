---
kind: function
module: OLESVR
name: SENDDATAMSG
ordinal: 24
summary: "The procedure `OLESVR.DLL` hands `EnumProps` for an item's window: one client's advised data sent."
versions:
  '3.1': exact
probes: [oleitem]
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

- [[read out]] `OLESVR.DLL` seg3 `2d3c`-`2edc`: called with the item's window, a property's name and its datum, the word naming the block of what that client asked of the item. Where the word names no block, or the client's window is gone, or the client did not advise the time [[fn:OLESVR.ITEMCALLBACK]] is telling, nothing. Otherwise the client is counted as sent; where it advised native data, the object's `Native` is asked for and sent; then, where it advised another format, that one -- each asked of the object for this client alone, each `WM_DDE_DATA` from the document's window, flags 2000h, the item named as at its time (`Item1`, `Item1/Save`, `Item1/Close`). A deferred advise is sent with no data. The answer is always 1.
- [[measured]] [[probe:oleitem]]: called with nought, 1 and nothing sent. As [[fn:OLESVR.ITEMCALLBACK]] runs it: native data first, though a picture was advised before it; a second conversation's `ObjectLink` in place of the picture it advised first; a deferred advise's `WM_DDE_DATA` with no block.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `SENDDATAMSG`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.

## Implementation

WinBox's own: `sendDataMsg` in `src/win16/olesvr/server.ts` and `send_data_msg` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

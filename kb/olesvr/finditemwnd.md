---
kind: function
module: OLESVR
name: FINDITEMWND
ordinal: 25
summary: "The procedure `OLESVR.DLL` hands `EnumChildWindows` for a document's window: one request of each item."
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
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[read out]] `OLESVR.DLL` seg3 `22ac`-`236e`: the high word of its `LPARAM` is the request, the low its word. 1 finds the item whose atom the word is, keeping its window and answering nought to stop the walk. 2 forgets the client whose window the word is: its block freed, its property taken from the item's window. 3 lets the item go (its object released, its window destroyed). 4 tells the item's object saved through [[fn:OLESVR.ITEMCALLBACK]], noting a save that reached no client for [[fn:OLESVR.OleSavedServerDoc]]. Otherwise, and after 2, 3 and 4, 1.
- [[measured]] [[probe:oleitem]]: Item1's window with Item1's atom and 1, nought; with Item3's, 1; the probe's own window with 9, 1; Item1's window with a conversation's window and 2, 1, and that conversation's property gone and no data sent it at the next change; Item1's window with 4, 1.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `FINDITEMWND`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.

## Implementation

WinBox's own: `findItemWnd` in `src/win16/olesvr/server.ts` and `find_item_wnd` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

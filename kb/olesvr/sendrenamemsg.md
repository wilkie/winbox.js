---
kind: function
module: OLESVR
name: SENDRENAMEMSG
ordinal: 30
summary: 'The procedure `OLESVR.DLL` hands `EnumProps` as a document is renamed: the new name sent to a client.'
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

- [[read out]] `OLESVR.DLL` seg3 `2cbc`-`2d39`: called with a window, a property's name and its datum, a client's block. Where the datum names a block, a copy of the renamed document's `Binary` block is posted the client as `WM_DDE_DATA` under `StdDocumentName`, from the window's parent. The answer is always 1.
- [[measured]] [[probe:oleitem]]: Item1's window with nought, 1 and nothing sent.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `SENDRENAMEMSG`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.
- [[inferred]] WinBox sends the document's name as it stands. The file sends the block of the rename in progress; outside one, what it would copy is not measured.

## Implementation

WinBox's own: `sendRenameMsg` in `src/win16/olesvr/server.ts` and `send_rename_msg` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

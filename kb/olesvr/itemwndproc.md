---
kind: function
module: OLESVR
name: ITEMWNDPROC
ordinal: 23
summary: "The window procedure of `ItemWndClass`, the class of the windows `OLESVR.DLL` keeps an object's clients in."
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

- [[measured]] [[probe:oleitem]]: an object's item window is of `ItemWndClass`, a child of its document's window, `WS_CHILD` alone, hidden, its text `ITEM`, its id nought. Its window words are a far pointer to the `OLECLIENT` the object was given. Each client that advised the item has a property on it ([[topic:ole]]).
- [[read out]] `OLESVR.DLL` seg3 `23b2`-`23f4`: `WM_DESTROY` is answered nought; every other message goes to `DefWindowProc`. Clients talk to the document's window, never to an item's.

## Nuances

- [[measured]] As WinBox ran `OLESVR.DLL` from the drive, its entry registered `ItemWndClass` with this procedure and four bytes of window words.

## Implementation

WinBox's own registers the class and answers as the file does (`src/win16/olesvr/index.ts`, `crates/winbox-win16/src/olesvr/mod.rs`), and makes an item window for each object as the file does ([[topic:ole]]).

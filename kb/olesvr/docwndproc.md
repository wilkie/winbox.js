---
kind: function
module: OLESVR
name: DOCWNDPROC
ordinal: 22
summary: "The window procedure of `DocWndClass`, a document's window: its conversations' advises, requests, pokes and executes."
versions:
  '3.1': exact
probes: [olesrv, oleitem]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

[[measured]] [[probe:olesrv]], item by item:

- **An item's object** is asked of the document's `GetObject` the first time a conversation names the item -- with an `OLECLIENT` OLESVR gives, whose `CallBack` is [[fn:OLESVR.ITEMCALLBACK]] -- and kept; refused (`GetObject` not `OLE_OK`), asked again next time. An item advised `item/Save` or `/Close` is the item before the slash.
- **A format** is found by calling the object's `EnumFormats` from nought until it answers the format, or nought.
- **Advise**: the object and format found, the format and when (change, `Save`, `Close`) kept for the conversation; acknowledged 8000h with the item's atom only where the advise has `fAckReq` -- without, no acknowledgement at all. An item the document refuses, 0000h. `StdDocumentName` is kept with no object.
- **Request**: the object's data in the format, `WM_DDE_DATA` flags 3000h (an answer, the client to free it): a picture, bitmap or palette as its handle, any other the bytes of the block the object gave. A format it does not enumerate, or an item refused, 0000h.
- **Poke**: `StdHostNames` is the document's `SetHostNames` with the two names; `StdDocDimensions` its `SetDocDimensions` with a rectangle from nought whose right is the first word poked and top the second (the third and fourth are not used); `StdColorScheme` its `SetColorScheme` with the poked `LOGPALETTE`; `StdTargetDevice` is kept and given to each object's `SetTargetDevice` just before its first `GetData`. Any other item is its object's `SetData` with a new block of the data alone. Acknowledged 8000h with the item's atom.
- **Execute**: `[StdShowItem("item"[,b])]` is the object's `Show` with the focus to take TRUE unless `b` is TRUE; `[StdDoVerbItem("item",verb,show,b)]` its `DoVerb` with the verb, `show`, and the focus the same way; `[StdCloseDocument]` is acknowledged first and then the document's `Close`. Anything else is the document's `Execute`, `Std` command or not, acknowledged by its answer.
- **Unadvise** of a format, or of nought for every format, acknowledged 8000h.
- **The windows** ([[probe:oleitem]]): the document's window has the text `Doc` and window words not nought; each conversation is its property, as on a server's window ([[fn:OLESVR.SRVRWNDPROC]]). Each object's first naming makes an item window beneath it ([[fn:OLESVR.ITEMWNDPROC]]), whose words point at the object's `OLECLIENT`: a block of 10h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE`, holding the client's table, the object, the block's own handle, the item's atom (nought for the document itself) and the item's window. A request makes one too.
- **What a client asked** ([[probe:oleitem]]): an advise keeps, as the client's property on the item's window, a block of whether it advised native data, the one other format it advised last, the times, and whether data goes with them; native data is sent first, then that format. An unadvise of an item takes away the time's bit whatever the format, so nothing is sent that client then, and the property stays; of the document itself (`""`), it forgets the client by every item. A client's terminate takes its properties off the document's and every item's window. [[read out]] seg3 `24bc`-`2586`, `26a9`-`2735`.
- **Terminate** from the client is answered with `WM_DDE_TERMINATE`, nothing called.

## Nuances

- [[measured]] [[probe:oleitem]]: an advise that defers its data (`fDeferUpd`) is sent `WM_DDE_DATA` with no block at each change.
- `unrecorded`: an unadvise of an item never named, which WinBox acknowledges 8000h; a `GetData` or `SetData` that fails; an advise of a format the object does not enumerate; `StdShowItem` of an item never named. WinBox refuses each with 0000h.

## Implementation

WinBox's own: `docWndProc` in `src/win16/olesvr/server.ts` and `doc_wnd_proc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

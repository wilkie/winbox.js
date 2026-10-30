---
kind: function
module: OLESVR
name: DOCWNDPROC
ordinal: 22
summary: "The window procedure of `DocWndClass`, a document's window: its conversations' advises, requests, pokes and executes."
versions:
  '3.1': exact
probes: [olesrv]
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
- **Terminate** from the client is answered with `WM_DDE_TERMINATE`, nothing called.

## Nuances

- `unrecorded`: a `GetData` or `SetData` that fails; an advise of a format the object does not enumerate; `StdShowItem` of an item never named. WinBox refuses each with 0000h.

## Implementation

WinBox's own: `docWndProc` in `src/win16/olesvr/server.ts` and `doc_wnd_proc` in `crates/winbox-win16/src/olesvr/server.rs`, written from the interface, OLE 1.0's protocol and the probe, not from the code of `OLESVR.DLL` ([[topic:ole]], "OLESVR"). Both engines agree with [[probe:olesrv]] and [[probe:olepbr]] with `OLESVR.DLL` on the drive and without it, and Paintbrush with neither `OLESVR.DLL` nor `OLECLI.DLL` (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

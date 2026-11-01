---
kind: function
module: OLESVR
name: ENUMFORTERMINATE
ordinal: 31
summary: "The procedure `OLESVR.DLL` hands `EnumProps` for a document's window: a conversation ended unless it is a client of one item."
versions:
  '3.1': exact
probes: [oleitem]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[read out]] `OLESVR.DLL` seg3 `2c5e`-`2cb8`: called with the document's window, a property's name and its datum, the client's window. Unless an item is set aside and the client has a property on its window, `WM_DDE_TERMINATE` is posted it from the document, and where that was posted the document's count of terminations awaited goes up. The file sets aside the item that advised `StdDocumentName` as it tells a rename. The answer is always 1.
- [[measured]] [[probe:oleitem]]: with nought, 1 and nothing posted.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `ENUMFORTERMINATE`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.

## Implementation

WinBox's own: `enumForTerminate` in `src/win16/olesvr/server.ts` and `enum_for_terminate` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

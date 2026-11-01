---
kind: function
module: OLESVR
name: TERMINATEDOCCLIENTS
ordinal: 28
summary: "The procedure `OLESVR.DLL` hands `EnumProps` for a document's window: a document's conversation ended."
versions:
  '3.1': exact
probes: [oleitem]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[read out]] `OLESVR.DLL` seg3 `1554`-`15a0`: as [[fn:OLESVR.TERMINATECLIENTS]], for a document's window and its count.
- [[measured]] [[probe:oleitem]]: with nought, 1 and nothing posted. With a conversation's window, 1, and the conversation ended from the document's window; once the client answers, its properties on the document's and every item's window are gone.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `TERMINATEDOCCLIENTS`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.

## Implementation

WinBox's own: `terminateClients` in `src/win16/olesvr/server.ts` and `terminate_clients` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

---
kind: function
module: OLESVR
name: TERMINATECLIENTS
ordinal: 27
summary: "The procedure `OLESVR.DLL` hands `EnumProps` for a server's window: a system conversation ended."
versions:
  '3.1': exact
probes: [oleitem]
source: src/win16/olesvr/server.ts
topics: [ole]
---

## Observed behaviour

- [[read out]] `OLESVR.DLL` seg3 `0752`-`079e`: called with the server's window, a property's name and its datum, the client's window. Where that is a window, `WM_DDE_TERMINATE` is posted it from the server's and the server's count of terminations awaited goes up. The answer is always 1.
- [[measured]] [[probe:oleitem]]: with a datum of nought, 1 and nothing posted. With the probe's system conversation's window, 1, and the conversation ended from the server's window; the client's answer is taken as its own terminate and answered, its property taken away, and with no other conversation left the server's `Release` is called.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `TERMINATECLIENTS`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.

## Implementation

WinBox's own: `terminateClients` in `src/win16/olesvr/server.ts` and `terminate_clients` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).

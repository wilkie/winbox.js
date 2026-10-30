---
kind: function
module: OLECLI
name: OleUnlockServer
ordinal: 55
summary: 'A server kept running by [[fn:OLECLI.OleLockServer]] let go.'
versions:
  '3.1': unrecorded
source: src/win16/olecli/api.ts
probes: [oledde, olepbd, olepbr]
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]]: a server WinBox locked: its system conversation ended, `OLE_WAIT_FOR_RELEASE`; the server exits once none is left.
- [[inferred]] No server is locked by WinBox's yet: every handle is `OLE_ERROR_HANDLE`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleUnlockServer` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

---
kind: function
module: OLECLI
name: OleUnlockServer
ordinal: 55
summary: 'A server kept running by [[fn:OLECLI.OleLockServer]] let go.'
versions:
  '3.1': unrecorded
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[inferred]] No server is locked by WinBox's yet: every handle is `OLE_ERROR_HANDLE`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleUnlockServer` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

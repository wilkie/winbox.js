---
kind: function
module: OLECLI
name: OleRelease
ordinal: 40
summary: "An object let go: its data and its block freed, its name's atom deleted, taken out of its document."
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: each static object released answers `OLE_OK`; [[fn:OLECLI.OleQueryReleaseStatus]] of it after is `OLE_ERROR_OBJECT`. NULL is `OLE_ERROR_OBJECT`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleRelease` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

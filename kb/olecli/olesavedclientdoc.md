---
kind: function
module: OLECLI
name: OleSavedClientDoc
ordinal: 45
summary: "A client's document saved: nothing to tell a static object."
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/docs.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: `OLE_OK`; nought `OLE_ERROR_HANDLE`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleSavedClientDoc` in `src/win16/olecli/docs.ts` and its twin in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

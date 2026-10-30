---
kind: function
module: OLECLI
name: OleDelete
ordinal: 2
summary: "An object let go and deleted from its document: what its table's `Delete` does; for a static object the same as its `Release`."
versions:
  '3.1': partial
probes: [olemem, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a cloned picture, bitmap and DIB deleted answered `OLE_OK`; NULL answered `OLE_ERROR_OBJECT` (13).
- [[measured]] [[probe:olemem]]: a static object's table holds the same method in its `Release` and `Delete` slots (300, 400, 500, 600).

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleDelete` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

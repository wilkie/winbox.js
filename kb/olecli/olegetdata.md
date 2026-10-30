---
kind: function
module: OLECLI
name: OleGetData
ordinal: 28
summary: "An object's data in a format, its handle the object's own."
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a picture gives format 3, a `METAFILEPICT` made the first time it is asked for (mode 8, its extents, its metafile); a bitmap 2, its bitmap; a DIB 8, its block. Any other format `OLE_ERROR_FORMAT`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleGetData` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

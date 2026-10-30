---
kind: function
module: OLECLI
name: OleEqual
ordinal: 8
summary: "Whether two objects' data are the same: `OLE_OK` or `OLE_ERROR_NOT_EQUAL`."
versions:
  '3.1': partial
probes: [olemem, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a picture and its clone, a DIB and its clone are equal; a bitmap and itself are not.
- [[measured]] [[probe:olemem]]: two bitmaps that differ answer `OLE_OK`, each way; two pictures that differ `OLE_ERROR_NOT_EQUAL`.
- [[read out]] The bitmap's method compares the bits and turns the answer of its comparison the wrong way: `OLECLI.DLL` seg11 `00e4` ([[fn:OLECLI.BMEQUAL]]).

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleEqual` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

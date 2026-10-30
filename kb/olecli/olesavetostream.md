---
kind: function
module: OLECLI
name: OleSaveToStream
ordinal: 3
summary: "An object written to the program's `OLESTREAM`, a field at a time through its `Put`."
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/kinds.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a picture wrote `Put`s of 4, 4, 4, 13, 4, 4, 4, 8 and 128 bytes, 173 in all: the version 0501h, the type 3 (static), the class `METAFILEPICT` with its length, the width and height in `MM_HIMETRIC` (the height negative), the data's size, its `METAFILEPICT` and its bits. A bitmap wrote its `BITMAP` and bits (621), a DIB its block (732).
- [[measured]] The bits written are the metafile's block's, as `GlobalSize` has it, and a DIB's block whole: what lies past the metafile or the DIB is what the machine's memory held (written `xx` in the probe's records).
- [[measured]] NULL answered `OLE_ERROR_OBJECT`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleSaveToStream` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

---
kind: function
module: OLECLI
name: OleLoadFromStream
ordinal: 4
summary: 'An object read back from a stream: the version and type, then for `Static` the class and what it keeps.'
versions:
  '3.1': partial
probes: [olemem, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: each of its own streams read back whole with `Static` (`OLE_OK`, every byte read); with `StdFileEditing` a static stream is `OLE_ERROR_PROTOCOL` (15) after 8 bytes.
- [[measured]] A version whose high word is not nought (another system's) is `OLE_ERROR_STATIC_FROM_OTHER_OS` (55); type nought `OLE_OK` with no object; types 1 and 6 under `Static` `OLE_ERROR_PROTOCOL`; a class's name of nought bytes `OLE_ERROR_STREAM` (5) after 12 bytes; a stream cut short `OLE_ERROR_STREAM` where it stopped giving.
- [[measured]] A class that is not `METAFILEPICT`, `BITMAP` or `DIB` makes an object of another class: its format, or nought and a name's length and name, then its data's size and data. Its type answers `OLE_ERROR_GENERIC`. A name of nought bytes leaves the name the stream before gave in its place ([[probe:olemem]]'s `noname`).
- [[measured]] A document that is not one is `OLE_ERROR_HANDLE` (18), a protocol neither `OLE_ERROR_PROTOCOL`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleLoadFromStream` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

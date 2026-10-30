---
kind: function
module: OLECLI
name: OleQueryBounds
ordinal: 18
summary: "An object's bounds in `MM_HIMETRIC`: nought, nought, its width and its height, negative."
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: 0,0,2000,-1000 for a picture of 2000 by 1000; 0,0,1270,-635 for a bitmap of 48 by 24 at 96 dots to the inch; 0,0,1269,-634 for a DIB of the same size. Another class's object writes noughts and answers `OLE_ERROR_GENERIC`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleQueryBounds` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

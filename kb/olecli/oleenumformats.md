---
kind: function
module: OLECLI
name: OleEnumFormats
ordinal: 26
summary: 'The formats an object can give, one after another: its one format after nought, nought after it.'
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: 3 then 0 for a picture, 2 then 0 for a bitmap, 8 then 0 for a DIB, the stream's format for another class's; NULL answers nought.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleEnumFormats` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

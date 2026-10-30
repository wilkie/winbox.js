---
kind: function
module: OLECLI
name: OleQueryCreateFromClip
ordinal: 10
summary: 'Whether an object could be made from what is on the clipboard.'
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: `Static` drawn is `OLE_OK` with a picture, a bitmap or a DIB there; with no rendering `OLE_ERROR_FORMAT`; in a format there `OLE_OK`. `StdFileEditing` with only those `OLE_ERROR_FORMAT`; a protocol neither `OLE_ERROR_PROTOCOL` (15).

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleQueryCreateFromClip` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

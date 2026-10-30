---
kind: function
module: OLECLI
name: OleCreateFromClip
ordinal: 12
summary: 'An object made from what is on the clipboard: for `Static`, a picture, a DIB or a bitmap.'
versions:
  '3.1': partial
probes: [olemem, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a picture, a bitmap and a DIB each make a static object; its type is 3, its bounds the picture's extents or the bitmap's and DIB's size in `MM_HIMETRIC`.
- [[measured]] [[probe:olemem]]: only `MM_ANISOTROPIC` pictures are taken; every other mode is `OLE_ERROR_MEMORY` (4). A picture whose width is not more than nought has bounds of nought.
- [[measured]] [[probe:olemem]]: a bitmap with a dimension has it, times ten, as its bounds; a DIB's are its size at its pels to a metre, the screen's where nought, written into its header.
- [[measured]] [[probe:olestat]]: document nought `OLE_ERROR_HANDLE`, an empty name `OLE_ERROR_NAME` (29), NULL out `OLE_ERROR_ADDRESS` (16), a protocol neither `OLE_ERROR_PROTOCOL`.

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").

## Implementation

WinBox's own: `OleCreateFromClip` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

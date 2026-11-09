---
kind: function
module: OLECLI
name: OleDraw
ordinal: 19
summary: "An object drawn into a device context, within the bounds given; into a metafile, within the window's bounds given too."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: the pixels of a picture, a bitmap and a DIB drawn into a bitmap agree; a bitmap into a metafile is `OLE_ERROR_MEMORY`.
- [[measured]] [[probe:olemem]]: a picture into a metafile is the context saved, clipped to the bounds, the picture's records (its window mapped into the window's bounds) and the context restored; with no window bounds `OLE_ERROR_DRAW` (8), the context left saved. A DIB is a palette of its colours, `StretchDIBits`, the default palette again.
- [[measured]] [[probe:olemem]]: every sixteenth record of a picture the client is asked `OLE_QUERY_PAINT`; its nought stops the drawing with `OLE_ERROR_ABORT` (10).

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleDraw` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

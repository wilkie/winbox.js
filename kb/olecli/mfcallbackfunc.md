---
kind: function
module: OLECLI
name: MFCALLBACKFUNC
ordinal: 102
summary: "The procedure a picture's records are enumerated through as it is drawn: each played, a metafile's window mapped, its client asked every sixteenth record."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: src/win16/olecli/draw.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: drawn into a metafile, a picture's `SetWindowOrg` is kept and its `SetWindowExt` written as the window's bounds' right and bottom scaled by the picture's extent over the bounds' width and height, then `SetWindowOrg` as the picture's origin less the bounds' left (and top) from the window's, scaled the same.
- [[measured]] [[probe:olemem]]: a picture of 41 records asks its client `OLE_QUERY_PAINT` twice and leaves seven records before the next asking; a client's nought stops it and [[fn:OLECLI.OleDraw]] answers `OLE_ERROR_ABORT`.

## Nuances

- [[measured]] The procedure is given the object's far pointer as `EnumMetaFile`'s data, as WinBox ran `OLECLI.DLL` from the drive and saw its arguments.

## Implementation

WinBox's own: `mfCallback` in `src/win16/olecli/draw.ts` and its twin in `crates/winbox-win16/src/olecli/draw.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

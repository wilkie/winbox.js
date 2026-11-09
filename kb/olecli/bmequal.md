---
kind: function
module: OLECLI
name: BMEQUAL
ordinal: 404
summary: "The Equal of a bitmap's table: compared with another object."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Equal slot of a bitmap's table. Its answers are [[fn:OLECLI.OleEqual]]'s for a bitmap ([[probe:olestat]]).
- [[measured]] [[probe:olestat]]: a bitmap and itself, its clone and its stream's copy answer `OLE_ERROR_NOT_EQUAL`; [[probe:olemem]]: a white bitmap and a black one answer `OLE_OK`.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg11 `00e4`: the two objects' sizes compared, then each one's bits by [[fn:GDI.GetBitmapBits]] into a block of its size, the counts compared, and the bytes by entry 1031 (seg3 `38a6`), which answers 1 for the same and nought for not; `BMEQUAL` makes 1 `OLE_ERROR_NOT_EQUAL` and nought `OLE_OK`. Bitmaps alike answer not equal, bitmaps that differ equal.

## Implementation

WinBox's own: `BMEQUAL` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

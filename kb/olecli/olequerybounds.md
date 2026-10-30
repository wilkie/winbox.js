---
kind: function
module: OLECLI
name: OleQueryBounds
ordinal: 18
summary: "An object's bounds in `MM_HIMETRIC`: nought, nought, its width and its height, negative."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: 0,0,2000,-1000 for a picture of 2000 by 1000; 0,0,1270,-635 for a bitmap of 48 by 24 at 96 dots to the inch; 0,0,1269,-634 for a DIB of the same size. Another class's object writes noughts and answers `OLE_ERROR_GENERIC`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleQueryBounds` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

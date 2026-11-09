---
kind: function
module: OLECLI
name: OleClone
ordinal: 6
summary: 'A copy of an object in a document, named: its data copied.'
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a picture's, a bitmap's and a DIB's clones answer every query as the object does, named `Clone`.
- [[measured]] [[probe:olemem]]: another class's object clones too.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleClone` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

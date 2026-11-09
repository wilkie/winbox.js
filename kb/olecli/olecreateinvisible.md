---
kind: function
module: OLECLI
name: OleCreateInvisible
ordinal: 58
summary: 'An embedded object made by its server without showing it.'
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/olecli/mod.rs
probes: [oledde, olepbd, olepbr]
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]]: not to be activated, the object is made blank and no server is started: `OLE_OK`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleCreateInvisible` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

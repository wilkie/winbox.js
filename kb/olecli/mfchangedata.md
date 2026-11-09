---
kind: function
module: OLECLI
name: MFCHANGEDATA
ordinal: 310
summary: "The ChangeData of a picture's table: its data made again from a handle."
versions:
  '3.1': partial
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the ChangeData slot of a picture's table.
- [[measured]] [[probe:olemem]]: given no handle it answers `OLE_ERROR_MEMORY`.

## Nuances

- [[documented]] The OLE 1.0 reference's object handlers: `ChangeData` makes the object's data again from a handle, freeing it where told to. WinBox's does so as from the clipboard; only the case of no handle is measured.

## Implementation

WinBox's own: `MFCHANGEDATA` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

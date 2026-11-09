---
kind: function
module: OLECLI
name: OleRelease
ordinal: 40
summary: "An object let go: its data and its block freed, its name's atom deleted, taken out of its document."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: each static object released answers `OLE_OK`; [[fn:OLECLI.OleQueryReleaseStatus]] of it after is `OLE_ERROR_OBJECT`. NULL is `OLE_ERROR_OBJECT`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleRelease` in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

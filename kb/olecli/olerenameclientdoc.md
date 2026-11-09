---
kind: function
module: OLECLI
name: OleRenameClientDoc
ordinal: 43
summary: "A client's document renamed."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: `OLE_OK`, and again to the same name; nought `OLE_ERROR_HANDLE`.
- [[inferred]] The links in it are not yet told.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleRenameClientDoc` in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

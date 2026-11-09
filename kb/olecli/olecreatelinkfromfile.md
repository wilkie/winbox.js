---
kind: function
module: OLECLI
name: OleCreateLinkFromFile
ordinal: 39
summary: 'A linked object made from a file and an item.'
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/olecli/mod.rs
probes: [oledde, olepbd, olepbr]
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]]: the file's document reached, or its server launched hidden with the file; the item and `StdDocumentName` advised, the item asked for, the conversation ended; released `OLE_CREATELINKFROMFILE`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleCreateLinkFromFile` in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

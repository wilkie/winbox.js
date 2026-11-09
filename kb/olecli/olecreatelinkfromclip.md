---
kind: function
module: OLECLI
name: OleCreateLinkFromClip
ordinal: 11
summary: 'A linked object made from what is on the clipboard.'
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/olecli/mod.rs
probes: [oledde, olepbd, olepbr]
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]]: `StdFileEditing`: a link to `ObjectLink`'s document and item with the clipboard's picture; no server asked; `OLE_OK`.
- [[inferred]] For `Static` no link is made: `OLE_ERROR_FORMAT`, as [[fn:OLECLI.OleQueryLinkFromClip]] answers.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleCreateLinkFromClip` in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

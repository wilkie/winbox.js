---
kind: function
module: OLECLI
name: OleSetBounds
ordinal: 17
summary: "An embedded object's bounds given its server. A static object's method answers `OLE_ERROR_MEMORY`."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: `OLE_ERROR_MEMORY` (4) for each static object; [[probe:olemem]]: a NULL rectangle `OLE_ERROR_ADDRESS` before the method.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleSetBounds` in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

---
kind: function
module: OLECLI
name: Ordinal1026
ordinal: 1026
summary: "A method a static object's table holds where it has no export of its own: RequestData, answering `OLE_ERROR_STATIC`."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: `GetProcAddress` finds entry 1026 in the slot of RequestData of each kind's table; called through the table it answers `OLE_ERROR_STATIC`.

## Nuances

- [[measured]] The entry has no name in the file's tables, but it is an entry: `GetProcAddress` by its ordinal finds it.

## Implementation

WinBox's own: `Ordinal1026` in `crates/winbox-win16/src/olecli/methods.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

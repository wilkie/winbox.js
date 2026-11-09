---
kind: function
module: OLECLI
name: ERREXECUTE
ordinal: 717
summary: "The Execute of a static object's table: it refuses, answering `OLE_ERROR_STATIC`."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: the Execute slot of a picture's, a bitmap's, a DIB's and another class's table; called through the table it answers `OLE_ERROR_STATIC`.

## Implementation

WinBox's own: `ERREXECUTE` in `crates/winbox-win16/src/olecli/methods.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

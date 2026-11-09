---
kind: function
module: OLECLI
name: ERRCOPYFROMLINK
ordinal: 706
summary: "The CopyFromLink of a static object's table: it refuses, answering `OLE_ERROR_STATIC`."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: the CopyFromLink slot of a picture's, a bitmap's, a DIB's and another class's table; called through the table it answers `OLE_ERROR_STATIC`.

## Implementation

WinBox's own: `ERRCOPYFROMLINK` in `src/win16/olecli/methods.ts` and its twin in `crates/winbox-win16/src/olecli/methods.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

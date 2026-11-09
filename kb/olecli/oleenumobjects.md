---
kind: function
module: OLECLI
name: OleEnumObjects
ordinal: 47
summary: "A document's objects, one after another, NULL after the last."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: an empty document gives NULL and `OLE_OK`; with three objects, three; nought `OLE_ERROR_HANDLE`. [[probe:olemem]]: in the order they were made.

## Implementation

WinBox's own: `OleEnumObjects` in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

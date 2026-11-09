---
kind: function
module: OLECLI
name: OleQueryClientVersion
ordinal: 59
summary: "The library's version: 1001h."
versions:
  '3.1': exact
probes: [olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: 00001001.

## Implementation

WinBox's own: `OleQueryClientVersion` in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

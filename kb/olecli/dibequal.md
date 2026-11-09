---
kind: function
module: OLECLI
name: DIBEQUAL
ordinal: 504
summary: "The Equal of a DIB's table: compared with another object."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Equal slot of a DIB's table. Its answers are [[fn:OLECLI.OleEqual]]'s for a DIB ([[probe:olestat]]).

## Implementation

WinBox's own: `DIBEQUAL` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

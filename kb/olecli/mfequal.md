---
kind: function
module: OLECLI
name: MFEQUAL
ordinal: 304
summary: "The Equal of a picture's table: compared with another object."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Equal slot of a picture's table. Its answers are [[fn:OLECLI.OleEqual]]'s for a picture ([[probe:olestat]]).

## Implementation

WinBox's own: `MFEQUAL` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

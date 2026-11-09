---
kind: function
module: OLECLI
name: GENCLONE
ordinal: 604
summary: "The Clone of another class's data's table: copied into another object."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Clone slot of another class's data's table. Its answers are [[fn:OLECLI.OleClone]]'s for another class's data.

## Implementation

WinBox's own: `GENCLONE` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

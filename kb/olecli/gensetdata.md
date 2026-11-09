---
kind: function
module: OLECLI
name: GENSETDATA
ordinal: 602
summary: "The SetData of another class's data's table: its data replaced, in its format."
versions:
  '3.1': partial
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the SetData slot of another class's data's table. Its answers are [[fn:OLECLI.OleSetData]]'s for another class's data.

## Implementation

WinBox's own: `GENSETDATA` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

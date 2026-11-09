---
kind: function
module: OLECLI
name: GENRELEASE
ordinal: 600
summary: "The Release of another class's data's table: its data and its block let go: `Release` and `Delete`."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Release slot of another class's data's table. Its answers are [[fn:OLECLI.OleRelease]]'s for another class's data.

## Implementation

WinBox's own: `GENRELEASE` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

---
kind: function
module: OLECLI
name: OBJQUERYSIZE
ordinal: 913
summary: "The QuerySize every kind's table shares: the bytes an object's stream would hold."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the QuerySize slot of every static kind's table. Its answers are [[fn:OLECLI.OleQuerySize]]'s ([[probe:olestat]]).

## Implementation

WinBox's own: `OBJQUERYSIZE` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

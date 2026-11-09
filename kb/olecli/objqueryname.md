---
kind: function
module: OLECLI
name: OBJQUERYNAME
ordinal: 910
summary: "The QueryName every kind's table shares: an object's name copied, the count set to its length."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the QueryName slot of every static kind's table. Its answers are [[fn:OLECLI.OleQueryName]]'s ([[probe:olestat]]).

## Implementation

WinBox's own: `OBJQUERYNAME` in `src/win16/olecli/objects.ts` and its twin in `crates/winbox-win16/src/olecli/objects.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

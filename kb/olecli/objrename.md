---
kind: function
module: OLECLI
name: OBJRENAME
ordinal: 911
summary: "The Rename every kind's table shares: an object renamed."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Rename slot of every static kind's table. Its answers are [[fn:OLECLI.OleRename]]'s ([[probe:olestat]]).

## Implementation

WinBox's own: `OBJRENAME` in `src/win16/olecli/objects.ts` and its twin in `crates/winbox-win16/src/olecli/objects.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

---
kind: function
module: OLECLI
name: ERRQUERYPROTOCOL
ordinal: 712
summary: "The QueryProtocol of a static object's table: it refuses, answering NULL."
versions:
  '3.1': exact
probes: [olemem]
source: src/win16/olecli/methods.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: the QueryProtocol slot of a picture's, a bitmap's, a DIB's and another class's table; called through the table it answers NULL.

## Implementation

WinBox's own: `ERRQUERYPROTOCOL` in `src/win16/olecli/methods.ts` and its twin in `crates/winbox-win16/src/olecli/methods.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

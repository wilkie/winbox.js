---
kind: function
module: OLECLI
name: DIBSAVETOSTREAM
ordinal: 502
summary: "The SaveToStream of a DIB's table: written to a stream."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: src/win16/olecli/kinds.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the SaveToStream slot of a DIB's table. Its answers are [[fn:OLECLI.OleSaveToStream]]'s for a DIB ([[probe:olestat]]).

## Implementation

WinBox's own: `DIBSAVETOSTREAM` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

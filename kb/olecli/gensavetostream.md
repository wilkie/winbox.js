---
kind: function
module: OLECLI
name: GENSAVETOSTREAM
ordinal: 603
summary: "The SaveToStream of another class's data's table: written to a stream."
versions:
  '3.1': exact
probes: [olemem]
source: src/win16/olecli/kinds.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the SaveToStream slot of another class's data's table. Its answers are [[fn:OLECLI.OleSaveToStream]]'s for another class's data.

## Implementation

WinBox's own: `GENSAVETOSTREAM` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

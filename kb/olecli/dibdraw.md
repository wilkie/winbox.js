---
kind: function
module: OLECLI
name: DIBDRAW
ordinal: 508
summary: "The Draw of a DIB's table: drawn."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: src/win16/olecli/draw.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Draw slot of a DIB's table. Its answers are [[fn:OLECLI.OleDraw]]'s for a DIB ([[probe:olestat]]).

## Implementation

WinBox's own: `DIBDRAW` in `src/win16/olecli/draw.ts` and its twin in `crates/winbox-win16/src/olecli/draw.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

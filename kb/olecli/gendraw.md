---
kind: function
module: OLECLI
name: GENDRAW
ordinal: 609
summary: "The Draw of another class's data's table: drawn."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Draw slot of another class's data's table. Its answers are [[fn:OLECLI.OleDraw]]'s for another class's data.
- [[measured]] [[probe:olemem]]: it answers `OLE_ERROR_GENERIC`.

## Implementation

WinBox's own: `GENDRAW` in `src/win16/olecli/draw.ts` and its twin in `crates/winbox-win16/src/olecli/draw.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

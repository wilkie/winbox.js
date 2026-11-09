---
kind: function
module: OLECLI
name: BMENUMFORMAT
ordinal: 409
summary: "The EnumFormats of a bitmap's table: its formats."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the EnumFormats slot of a bitmap's table. Its answers are [[fn:OLECLI.OleEnumFormats]]'s for a bitmap ([[probe:olestat]]).

## Implementation

WinBox's own: `BMENUMFORMAT` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

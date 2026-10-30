---
kind: function
module: OLECLI
name: GENENUMFORMAT
ordinal: 610
summary: "The EnumFormats of another class's data's table: its formats."
versions:
  '3.1': exact
probes: [olemem]
source: src/win16/olecli/kinds.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the EnumFormats slot of another class's data's table. Its answers are [[fn:OLECLI.OleEnumFormats]]'s for another class's data.

## Implementation

WinBox's own: `GENENUMFORMAT` in `src/win16/olecli/kinds.ts` and its twin in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

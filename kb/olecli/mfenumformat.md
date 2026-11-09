---
kind: function
module: OLECLI
name: MFENUMFORMAT
ordinal: 309
summary: "The EnumFormats of a picture's table: its formats."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the EnumFormats slot of a picture's table. Its answers are [[fn:OLECLI.OleEnumFormats]]'s for a picture ([[probe:olestat]]).

## Implementation

WinBox's own: `MFENUMFORMAT` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

---
kind: function
module: OLECLI
name: MFSAVETOSTREAM
ordinal: 302
summary: "The SaveToStream of a picture's table: written to a stream."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the SaveToStream slot of a picture's table. Its answers are [[fn:OLECLI.OleSaveToStream]]'s for a picture ([[probe:olestat]]).

## Implementation

WinBox's own: `MFSAVETOSTREAM` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

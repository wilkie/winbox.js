---
kind: function
module: OLECLI
name: DIBDRAW
ordinal: 508
summary: "The Draw of a DIB's table: drawn."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the Draw slot of a DIB's table. Its answers are [[fn:OLECLI.OleDraw]]'s for a DIB ([[probe:olestat]]).

## Implementation

WinBox's own: `DIBDRAW` in `crates/winbox-win16/src/olecli/draw.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

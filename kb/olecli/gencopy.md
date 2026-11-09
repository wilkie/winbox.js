---
kind: function
module: OLECLI
name: GENCOPY
ordinal: 606
summary: "The CopyToClipboard of another class's data's table: a copy put on the clipboard."
versions:
  '3.1': exact
probes: [olemem]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the CopyToClipboard slot of another class's data's table. Its answers are [[fn:OLECLI.OleCopyToClipboard]]'s for another class's data.

## Implementation

WinBox's own: `GENCOPY` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

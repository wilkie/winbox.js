---
kind: function
module: OLECLI
name: OleIsDcMeta
ordinal: 60
summary: "Whether a device context is a metafile's: its technology `DT_METAFILE`."
versions:
  '3.1': exact
probes: [olestat]
source: src/win16/olecli/draw.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: 1 for a metafile's context, nought for the screen's.

## Implementation

WinBox's own: `OleIsDcMeta` in `src/win16/olecli/draw.ts` and its twin in `crates/winbox-win16/src/olecli/draw.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

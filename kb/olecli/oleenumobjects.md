---
kind: function
module: OLECLI
name: OleEnumObjects
ordinal: 47
summary: "A document's objects, one after another, NULL after the last."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: src/win16/olecli/docs.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: an empty document gives NULL and `OLE_OK`; with three objects, three; nought `OLE_ERROR_HANDLE`. [[probe:olemem]]: in the order they were made.

## Implementation

WinBox's own: `OleEnumObjects` in `src/win16/olecli/docs.ts` and its twin in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

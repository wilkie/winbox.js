---
kind: function
module: OLECLI
name: ERRGETUPDATEOPTIONS
ordinal: 715
summary: "The GetLinkUpdateOptions of a static object's table: it refuses, answering `OLE_ERROR_STATIC`."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: src/win16/olecli/methods.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: the GetLinkUpdateOptions slot of a picture's, a bitmap's, a DIB's and another class's table; called through the table it answers `OLE_ERROR_STATIC`.
- [[measured]] [[probe:olestat]]: the option given it is left as it was.

## Implementation

WinBox's own: `ERRGETUPDATEOPTIONS` in `src/win16/olecli/methods.ts` and its twin in `crates/winbox-win16/src/olecli/methods.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

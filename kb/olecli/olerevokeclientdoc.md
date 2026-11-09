---
kind: function
module: OLECLI
name: OleRevokeClientDoc
ordinal: 42
summary: "A client's document let go, once it has no objects."
versions:
  '3.1': exact
probes: [olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: with objects still in it `OLE_ERROR_NOT_EMPTY` (25); nought `OLE_ERROR_HANDLE`; revoked twice `OLE_ERROR_HANDLE`; a string beginning `CD` is taken for a document, and is not empty.

## Implementation

WinBox's own: `OleRevokeClientDoc` in `src/win16/olecli/docs.ts` and its twin in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

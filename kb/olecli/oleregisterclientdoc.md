---
kind: function
module: OLECLI
name: OleRegisterClientDoc
ordinal: 41
summary: "A client's document registered: a block whose far pointer is its handle, its class and name as atoms."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: src/win16/olecli/docs.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: the same name registered twice is two documents. An empty name is `OLE_ERROR_NAME`; a NULL name, class or out pointer `OLE_ERROR_ADDRESS`.
- [[measured]] [[probe:olemem]]: the block is 18h bytes (32 by `GlobalSize`): `CD`, the first and last objects, the class's and name's atoms, its own handle, the documents before and after it ([[topic:ole]]).

## Implementation

WinBox's own: `OleRegisterClientDoc` in `src/win16/olecli/docs.ts` and its twin in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

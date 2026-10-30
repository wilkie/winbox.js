---
kind: function
module: OLECLI
name: OleCreate
ordinal: 34
summary: "An embedded object made by its class's server."
versions:
  '3.1': partial
probes: [olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: `Static` is `OLE_ERROR_PROTOCOL`; a class the registration database does not have `OLE_ERROR_CLASS` (20).

## Nuances

- [[inferred]] Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").
- [[documented]] The OLE 1.0 reference: the class's server is found in the registration database and launched, and the object made by it through DDE. With `OLECLI.DLL` on the drive, `StdFileEditing` is the file's code's, as before; with none, WinBox's checks the protocol and the class, and answers `OLE_ERROR_LAUNCH` (35) for a class it finds: no server is launched yet.

## Implementation

WinBox's own: `OleCreate` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

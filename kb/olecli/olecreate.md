---
kind: function
module: OLECLI
name: OleCreate
ordinal: 34
summary: "An embedded object made by its class's server."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]]: `StdFileEditing`: the class's server reached on `OLEsystem` or `System`, or launched shown (`server -Embedding`); `[StdNewDocument("class","doc")]`, the document's conversation, `/Save` and `/Close` advised, `[StdShowItem("")]`; `OLE_WAIT_FOR_RELEASE`, released `OLE_CREATE`.
- [[measured]] [[probe:olestat]]: `Static` is `OLE_ERROR_PROTOCOL`; a class the registration database does not have `OLE_ERROR_CLASS` (20).

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleCreate` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

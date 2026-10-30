---
kind: function
module: OLECLI
name: OleSavedClientDoc
ordinal: 45
summary: "A client's document saved: nothing to tell a static object."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olestat]
source: src/win16/olecli/docs.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: `OLE_OK`; nought `OLE_ERROR_HANDLE`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleSavedClientDoc` in `src/win16/olecli/docs.ts` and its twin in `crates/winbox-win16/src/olecli/docs.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

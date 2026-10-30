---
kind: function
module: OLECLI
name: OleDelete
ordinal: 2
summary: "An object let go and deleted from its document: what its table's `Delete` does; for a static object the same as its `Release`."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olemem, olestat]
source: src/win16/olecli/api.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a cloned picture, bitmap and DIB deleted answered `OLE_OK`; NULL answered `OLE_ERROR_OBJECT` (13).
- [[measured]] [[probe:olemem]]: a static object's table holds the same method in its `Release` and `Delete` slots (300, 400, 500, 600).

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleDelete` in `src/win16/olecli/api.ts` and its twin in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

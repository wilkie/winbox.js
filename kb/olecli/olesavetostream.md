---
kind: function
module: OLECLI
name: OleSaveToStream
ordinal: 3
summary: "An object written to the program's `OLESTREAM`, a field at a time through its `Put`."
versions:
  '3.1': partial
probes: [oledde, olepbd, olepbr, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olestat]]: a picture wrote `Put`s of 4, 4, 4, 13, 4, 4, 4, 8 and 128 bytes, 173 in all: the version 0501h, the type 3 (static), the class `METAFILEPICT` with its length, the width and height in `MM_HIMETRIC` (the height negative), the data's size, its `METAFILEPICT` and its bits. A bitmap wrote its `BITMAP` and bits (621), a DIB its block (732).
- [[measured]] The bits written are the metafile's block's, as `GlobalSize` has it, and a DIB's block whole: what lies past the metafile or the DIB is what the machine's memory held (written `xx` in the probe's records).
- [[measured]] NULL answered `OLE_ERROR_OBJECT`.

## Nuances

- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleSaveToStream` in `crates/winbox-win16/src/olecli/kinds.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

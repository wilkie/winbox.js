---
kind: function
module: OLECLI
name: Ordinal1030
ordinal: 1030
summary: "A method a static object's table holds where it has no export of its own: another class's QueryType, answering `OLE_ERROR_GENERIC`."
versions:
  '3.1': exact
probes: [olemem]
source: src/win16/olecli/methods.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: `GetProcAddress` finds entry 1030 in the slot of another class's QueryType of each kind's table; called through the table it answers `OLE_ERROR_GENERIC`.

## Nuances

- [[measured]] The entry has no name in the file's tables, but it is an entry: `GetProcAddress` by its ordinal finds it.

## Implementation

WinBox's own: `Ordinal1030` in `src/win16/olecli/methods.ts` and its twin in `crates/winbox-win16/src/olecli/methods.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olestat]] and [[probe:olemem]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).

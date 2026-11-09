---
kind: function
module: OLECLI
name: OBJQUERYTYPE
ordinal: 912
summary: "The QueryType every kind's table shares: a static object's type, 3."
versions:
  '3.1': exact
probes: [olemem, olestat]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olemem]]: in the QueryType slot of every static kind's table. Its answers are [[fn:OLECLI.OleQueryType]]'s ([[probe:olestat]]).
- [[measured]] Another class's table holds entry 1030 in its place, which answers `OLE_ERROR_GENERIC`.

## Implementation

WinBox's own: `OBJQUERYTYPE` in `crates/winbox-win16/src/olecli/objects.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olestat]], [[probe:olemem]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).

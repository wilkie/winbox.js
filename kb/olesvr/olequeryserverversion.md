---
kind: function
module: OLESVR
name: OleQueryServerVersion
ordinal: 12
summary: "The library's version: 1001h."
versions:
  '3.1': exact
probes: [olesrv]
source: src/win16/olesvr/core.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olesrv]]: 00001001.

## Implementation

WinBox's own: `SERVER_VERSION` in `src/win16/olesvr/core.ts` and `crates/winbox-win16/src/olesvr/core.rs` ([[topic:ole]]).

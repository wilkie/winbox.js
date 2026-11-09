---
kind: function
module: OLESVR
name: WEP
ordinal: 1
summary: "OLESVR's exit procedure, called as the library is freed: 1."
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Nuances

- [[documented]] A library's `WEP` is called with `WEP_FREE_DLL` or `WEP_SYSTEM_EXIT` as it is freed, and answers 1.

## Implementation

WinBox's own: `wep` in `crates/winbox-win16/src/olesvr/mod.rs` answers 1. WinBox's `OLESVR`'s data -- its servers, documents and what it does as it starts -- goes as its library goes (`ownFreed`, `own_modules::freed_named`) ([[topic:ole]]).

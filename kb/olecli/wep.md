---
kind: function
module: OLECLI
name: WEP
ordinal: 1
summary: "OLECLI's exit procedure, called as the library is freed: 1."
versions:
  '3.1': unrecorded
source: src/win16/olecli/index.ts
topics: [ole]
---

## Nuances

- [[documented]] A library's `WEP` is called with `WEP_FREE_DLL` or `WEP_SYSTEM_EXIT` as it is freed, and answers 1.

## Implementation

WinBox's own: `WEP` in `src/win16/olecli/index.ts` and `wep` in `crates/winbox-win16/src/olecli/mod.rs` answer 1. WinBox's `OLECLI`'s data -- its documents' list and what it does as it starts -- goes as its library goes (`ownFreed`, `own_modules::freed_named`).

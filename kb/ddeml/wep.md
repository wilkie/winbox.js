---
kind: function
module: DDEML
name: WEP
ordinal: 1
summary: DDEML's exit procedure, called as the library is freed: it answers 1.
versions:
  '3.1': unrecorded
source: src/win16/ddeml/exports.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

- [[read out]] `DDEML.DLL` seg2 `002c`: for either reason it is called with, `WEP_SYSTEM_EXIT` or `WEP_FREE_DLL`, it answers 1, and does nothing else. What an instance leaves is freed by [[fn:DDEML.DdeUninitialize]], not here.
- [[read out]] The library's entry (seg2 `0000`) refuses to load outside protected mode, by `GetWinFlags`, and keeps its instance handle at `[16h]` of its data, which it registers its classes and makes its windows with.

## Implementation

WinBox's own: `WEP` in `src/win16/ddeml/exports.ts` and `wep` in `crates/winbox-win16/src/ddeml/mod.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It answers 1. The library's entry's work -- its data and its local heap, its instance at `[16h]` -- is done the first time any export is called, on WinBox's own data segment for the module. Not yet recorded.

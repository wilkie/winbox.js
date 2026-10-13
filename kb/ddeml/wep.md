---
kind: function
module: DDEML
name: WEP
ordinal: 1
summary: DDEML's exit procedure, called as the library is freed: it answers 1.
topics: [dynamic-data-exchange]
---

## Inside Windows

- [[read out]] `DDEML.DLL` seg2 `002c`: for either reason it is called with, `WEP_SYSTEM_EXIT` or `WEP_FREE_DLL`, it answers 1, and does nothing else. What an instance leaves is freed by [[fn:DDEML.DdeUninitialize]], not here.
- [[read out]] The library's entry (seg2 `0000`) refuses to load outside protected mode, by `GetWinFlags`, and keeps its instance handle at `[16h]` of its data, which it registers its classes and makes its windows with.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.

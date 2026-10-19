---
kind: function
module: DDEML
name: WEP
ordinal: 1
summary: DDEML's exit procedure, called as the library is freed. It answers 1 and ends no instance still open.
versions:
  '3.1': partial
probes: [ddewep]
source: src/win16/ddeml/exports.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddewep]]: called through `GetProcAddress` with 0 and 1 it answered 1. With 2 it answered one more than [[fn:KERNEL.LoadLibrary]]'s answer for `DDEML.DLL`: the library's data segment, whose handle is its instance.
- [[measured]] A program that imports DDEML made an instance, two string handles and a registered name, and ended without [[fn:DDEML.DdeUninitialize]]. Its library went with it: [[fn:KERNEL.GetModuleHandle]] found no `DDEML` after. Both strings were still atoms. DDEML loaded again by another program started from its file's data: the instance it made had the serial the first program's had.

## Nuances

- [[read out]] For any number but `WEP_FREE_DLL` and `WEP_SYSTEM_EXIT` it answers what AX held as it was called. The entry's prologue loads AX with the library's data segment, so that is the answer (seg2 `0036`-`0045`).
- [[read out]] Nothing of an instance left open is freed: not its atoms, not its heap, not its windows. DDEML's window procedure has nothing to do as its windows are destroyed with their task (`DMGWNDPROC`, seg1 `5558`). Only `DdeUninitialize` frees an instance.

## Inside Windows

- [[read out]] `DDEML.DLL` seg2 `002c`: 1 for nought and for 1, and nothing else done.
- [[read out]] The library's entry (seg2 `0000`) refuses to load outside protected mode, by `GetWinFlags`, and keeps its instance handle at `[16h]` of its data, which it registers its classes and makes its windows with.

## Implementation

WinBox's own: `WEP` in `src/win16/ddeml/exports.ts` and `wep` in `crates/winbox-win16/src/ddeml/mod.rs` follow `DDEML.DLL` as read out above. For any other number they answer DDEML's data segment, WinBox's own, which stands for the file's. The library's entry's work -- its data and its local heap, its instance at `[16h]` -- is done the first time any export is called, on WinBox's own data segment for the module. When `DDEML.DLL`'s library is let go, by `FreeLibrary` or by the last program that imported it ending, that work is undone, and done again at the next export called (`freed` in `exports.ts`, `ddeml::freed`).

[[probe:ddewep]] agrees in both engines but for the answer for 2: a library's instance in WinBox is a handle from a table of its own, not its data segment's, so the data segment is not one more than it. With no `DDEML.DLL` on the drive, WinBox's own is no library that is loaded and let go. `GetModuleHandle` does not find it while a program that imports it runs, and nothing undoes its data when that program ends (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).

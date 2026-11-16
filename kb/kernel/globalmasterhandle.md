---
kind: function
module: KERNEL
name: GlobalMasterHandle
ordinal: 28
summary: The handle and selector of the block that heads KERNEL's global heap — what TOOLHELP walks the heap from.
versions:
  '3.1': exact
probes: [kgaps]
records: [master]
source: crates/winbox-win16/src/kernel_calls/thhook.rs
topics: [kernel-internals, tool-helper]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `1190`-`119e` (`KRNL286.EXE` seg1 `1159`). No arguments. AX is the word at 218h of KERNEL's data, DX the word at 21Ah. They are the first two words of the structure [[fn:KERNEL.THHOOK]] points to. 21Ah is the selector of the global heap's own block, which KERNEL loads to find an arena (seg1 `0ef6`); 218h is its handle.
- [[read out]] In that block are the heap's counts and the offsets of its first and last arenas. TOOLHELP reads them: its start-up takes DX, finds the block, and reads its word 6 to tell the build apart (TOOLHELP seg1 `01e9`-`0208`).
- Recorded on Windows earlier (noted under [[topic:kernel-queries]], with no probe of its own kept): AX the block's handle, its limit 257BFh, its first words 0, 0, then the count of arenas (one less than TOOLHELP's `wcItems`), the first and last arenas' offsets (80h, E0h) and 4000h.
- [[measured]] [[probe:kgaps]]: AX and DX are the same selector, odd, and `GlobalHandle` of it answers it as both handle and selector: a fixed block. [[fn:KERNEL.THHOOK]]'s first two words are the same pair.

## Callers

- [[read out]] `TOOLHELP.DLL` imports it by ordinal and calls it once as it starts (seg1 `01e9`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (a).** WinBox makes a fixed block of KERNEL's the first time it is asked for, or `THHOOK`'s address handed out, and answers its selector in AX and DX; `GlobalHandle` answers it as both handle and selector (`GlobalMasterHandle` in `crates/winbox-win16/src/kernel_calls/thhook.rs`). Since 2026-11-15 the block runs to the end of the selector table, as Windows' does (its limit 257BFh in standard mode, [[probe:seltab]]), and holds an arena for each of WinBox's blocks and the table ([[fn:KERNEL.THHOOK]]); its bytes are not counted as held. See [[topic:kernel-internals]].

## Not yet done

- The heap's header in the block, for a debugger that walks it. Recorded on Windows earlier: its first words 0, 0, the count of arenas, the first and last arenas' offsets and 4000h. The arenas WinBox lays out have the words TOOLHELP reads, not the links back or the free blocks' and sentinels' ([[fn:KERNEL.THHOOK]]).

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

**Implemented (a).** Both engines make a fixed block of KERNEL's the first time it is asked for, 46h bytes, as far as the words KERNEL's own code touches in it run (seg1 `2bbe`-`2bcb`, `97fd`-`9802`), and answer its selector in AX and DX; `GlobalHandle` answers it as both handle and selector (`GlobalMasterHandle` in `crates/winbox-win16/src/kernel_calls/thhook.rs`). Its words read as noughts: WinBox keeps its blocks in itself and lays out no arenas for a walker. See [[topic:kernel-internals]].

## Not yet done

- The heap's header and arenas in the block, kept to agree with WinBox's own blocks, for a debugger that walks them. Recorded on Windows earlier: its first words 0, 0, the count of arenas, the first and last arenas' offsets and 4000h.

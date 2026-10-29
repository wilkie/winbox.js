---
kind: function
module: KERNEL
name: GlobalMasterHandle
ordinal: 28
summary: The handle and selector of the block that heads KERNEL's global heap — what TOOLHELP walks the heap from.
topics: [kernel-internals, tool-helper]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `1190`-`119e` (`KRNL286.EXE` seg1 `1159`). No arguments. AX is the word at 218h of KERNEL's data, DX the word at 21Ah. They are the first two words of the structure [[fn:KERNEL.THHOOK]] points to. 21Ah is the selector of the global heap's own block, which KERNEL loads to find an arena (seg1 `0ef6`); 218h is its handle.
- [[read out]] In that block are the heap's counts and the offsets of its first and last arenas. TOOLHELP reads them: its start-up takes DX, finds the block, and reads its word 6 to tell the build apart (TOOLHELP seg1 `01e9`-`0208`).
- Recorded on Windows earlier (noted under [[topic:kernel-queries]], with no probe of its own kept): AX the block's handle, its limit 257BFh, its first words 0, 0, then the count of arenas (one less than TOOLHELP's `wcItems`), the first and last arenas' offsets (80h, E0h) and 4000h.

## Callers

- [[read out]] `TOOLHELP.DLL` imports it by ordinal and calls it once as it starts (seg1 `01e9`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines. WinBox's TOOLHELP is its own and answers `GlobalFirst` and the rest from WinBox's own blocks ([[topic:tool-helper]]). WinBox has no master block.

**Recommendation: not needed for now; a fixed answer if a program turns up that calls it.** Answering it faithfully means laying out a heap header that agrees with WinBox's blocks, a sizeable piece of work, and only a debugger or a memory viewer made for Windows 3.1 would read it. If one does, a block with the header's counts and two arena offsets, built from WinBox's blocks when the call comes, would be enough. That is medium work, and it pays only together with [[fn:KERNEL.THHOOK]]. See [[topic:kernel-internals]].

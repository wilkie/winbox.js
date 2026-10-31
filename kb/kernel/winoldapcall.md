---
kind: function
module: KERNEL
name: WinOldApCall
ordinal: 151
summary: Standard mode's WinOldAp asks KERNEL to close the files it keeps open before a DOS program runs; with nought it answers five words of KERNEL's data instead.
versions:
  '3.1': partial
probes: [kgaps]
records: [winoldap, kernelpdb]
source: src/win16/kernel/internals.ts
topics: [kernel-internals, task-list]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `07e6`-`081a` (the same offset in `KRNL286.EXE`). One word, popped.
  - Not nought: it calls seg1 `534c` with KERNEL's own prefix (220h). That routine closes every handle in KERNEL's cache of open module files ([[fn:KERNEL.FlushCachedFileHandle]]) and empties the cache's entries, because the prefix is KERNEL's own (seg1 `534c`-`5384`). The word at 279h, the prefix KERNEL makes its DOS calls for, is kept and put back around the call.
  - Nought: it answers AX, BX, CX and DX from the words at 251h, 253h, 255h and 257h of KERNEL's data, and DI from 271h (`0806`-`0815`). The words 251h-257h are nought in the file, and no instruction of KERNEL's writes them that a sweep of its code finds. 271h is set while KERNEL starts (seg1 `b9f5`).
- [[read out]] seg1 `534c` keeps AX, BX, CX and DI and leaves DX the prefix it was given, KERNEL's own; BX is the stack pointer after `push ds` (`07ea`). 271h is set from the DOS beneath as KERNEL starts (seg1 `b9cd`-`b9f5`, the routine at `ba10`).
- [[measured]] [[probe:kgaps]]: nought answers AX, BX, CX and DX nought and DI 10h; 1 keeps AX, CX and DI, BX the stack pointer as described and DX KERNEL's prefix, the parent of the probe's.

## Callers

- [[read out]] `WINOLDAP.MOD`, the standard mode's WinOldAp, imports it by ordinal. Before it runs a DOS program, it marks the current prefix ([[fn:KERNEL.GetCurrentPDB]]), sets bit 0 of the prefix's byte 48h, and calls this with 1 (WINOLDAP seg1 `29f2`-`2a05`). So no file Windows holds open is held across the DOS program. The enhanced mode's `WINOA386.MOD` does not import it. No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (a).** Both engines answer the registers above (`WinOldApCall` in `src/win16/kernel/internals.ts`); WinBox keeps no module file open, so nothing is closed. DI's 10h is DOSBox's DOS's, as WinBox's is.

## Not yet done

- DX for 1, KERNEL's own prefix (`kgaps:kernelpdb`, a known gap): WinBox keeps no prefix of KERNEL's, and a task's prefix has no parent; it answers nought.

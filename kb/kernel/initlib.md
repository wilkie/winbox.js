---
kind: function
module: KERNEL
name: InitLib
ordinal: 116
summary: A library's start-up in registers — its local heap made from CX, as LocalInit makes one; no module of Windows 3.1 calls it.
topics: [kernel-internals, dynamic-link-libraries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `2797`-`27b3` (`KRNL286.EXE` seg2 `278b`). It takes its arguments in registers, as a library's entry is given them: CX is the size of the local heap, DS the library's data segment.
  1. AX starts at nought. With CX nought, nothing more is done to the heap.
  2. Otherwise it calls [[fn:KERNEL.LocalInit]] with nought, nought and CX, a heap from the start of DS to CX, and AX is what that answers (`279b`-`27a2`). CX is kept unless `LocalInit` left it nought.
  3. It answers with ES the selector of KERNEL's own data, DS the library's again, and SI 842Ah (`27a9`-`27b0`). It pops nothing.
- [[inferred]] It does what a library's start-up code does itself (the SDK's `LibEntry` calls `LocalInit`), so a library could call it in place of its own. ES, and SI's 842Ah, are left over from KERNEL's own use and are not meant for the caller.
- Not yet measured.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`). Every library there makes its heap itself.

## Implementation

A stub in both engines, which leaves the registers as they were.

**Recommendation: implement as Windows does, if ever wanted.** It is a call to WinBox's own `LocalInit` with the registers above: about ten lines in each engine. No program in the corpus would notice, so it is low on the list. See [[topic:kernel-internals]].

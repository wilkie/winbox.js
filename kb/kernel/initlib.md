---
kind: function
module: KERNEL
name: InitLib
ordinal: 116
summary: A library's start-up in registers — its local heap made from CX, as LocalInit makes one; no module of Windows 3.1 calls it.
versions:
  '3.1': exact
probes: [kgaps]
records: [initlib]
source: crates/winbox-win16/src/kernel_calls/internals.rs
topics: [kernel-internals, dynamic-link-libraries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `2797`-`27b3` (`KRNL286.EXE` seg2 `278b`). It takes its arguments in registers, as a library's entry is given them: CX is the size of the local heap, DS the library's data segment.
  1. AX starts at nought. With CX nought, nothing more is done to the heap.
  2. Otherwise it calls [[fn:KERNEL.LocalInit]] with nought, nought and CX, a heap from the start of DS to CX, and AX is what that answers (`279b`-`27a2`). CX is kept unless `LocalInit` left it nought.
  3. It answers with ES the selector of KERNEL's own data, DS the library's again, and SI 842Ah (`27a9`-`27b0`). It pops nothing.
- [[inferred]] It does what a library's start-up code does itself (the SDK's `LibEntry` calls `LocalInit`), so a library could call it in place of its own. ES, and SI's 842Ah, are left over from KERNEL's own use and are not meant for the caller.
- [[measured]] [[probe:kgaps]]: with CX nought, AX and CX nought, DX and DI kept, ES KERNEL's data, SI 842Ah, DS kept, nothing popped. With CX 200h and DS a block of 400h bytes, AX 1, CX 200h, DS the block, the heap's information at 210h (the block's word 6): its last 200h bytes.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`). Every library there makes its heap itself.

## Implementation

**Implemented (a).** WinBox takes CX and DS as given, make the heap with their own `LocalInit(0, 0, CX)` where CX is not nought, and leave ES KERNEL's data and SI 842Ah (`InitLib` in `crates/winbox-win16/src/kernel_calls/internals.rs`). See [[topic:kernel-internals]].

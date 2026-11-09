---
kind: function
module: KERNEL
name: PatchCodeHandle
ordinal: 110
summary: Fixes up the prologues of a loaded code segment's exported functions so that each loads its data segment; the segment loader calls it, and nothing else does.
versions:
  '3.1': exact
probes: [kgaps]
records: [patch]
source: crates/winbox-win16/src/kernel_calls/internals.rs
topics: [kernel-internals, dynamic-link-libraries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7bac`-`7ca5` (`KRNL286.EXE` seg1 `7412`). The argument is a code segment's handle; two bytes are popped.
  1. It finds the block's owner (seg1 `29bf`, [[fn:KERNEL.K404]]'s routine). Unless that owner is a module database (`NE`) it answers at once (`7bb8`-`7bd9`).
  2. It looks through the module's segment table (word 22h, count at 1Ch, ten bytes an entry) for the entry whose handle is this one, and so finds the segment's number. A data segment is passed over, and so is one already patched, flag 04h of the entry (`7bde`-`7c08`).
  3. It finds the handle of the module's own data segment, if it has one (the entry word 8 of the module database points to, `7c0b`-`7c1b`). It also makes a writable alias of the code segment in a spare descriptor (seg1 `258f`, type F3h).
  4. It walks the module's entry table, from word 4 of the module database: bundles of a first and a last ordinal and five-byte entries (`7c26`-`7c8b`). For each entry in this segment whose code starts `push ds; pop ax; nop` (1Eh 58h 90h) or `mov ax,ds; nop` (8Ch D8h 90h), it does one of three things.
     - If the entry's flags have 02h (the entry uses shared data), it writes `mov ax, <data selector>`.
     - Otherwise, if the module's flags (0Ch) have 02h and the entry's have 01h (exported), it writes two `nop`s, so the code leaves AX as the caller set it.
     - Otherwise it writes `mov ax,ds`, which loads AX from DS.
  5. It marks the segment entry patched (flag 04h) and answers the handle in AX and the module's data handle in DX (`7c96`-`7ca5`).
- [[inferred]] This is the fix-up that lets a function exported by a program or a library reach its own data: a far function's prologue loads DS from AX, and the patched instruction decides where AX comes from.
- [[read out]] Correcting the steps above: the segment entry passed over is a data one, its flag 01h (`7c02`); no flag says it was patched before. A prologue already patched is not one of the two the routine looks for, so a second call changes nothing. DX is the selector seg1 `0ede` makes of the handle -- the arena's handle with its low bit set -- or nought where the handle names no block.
- [[measured]] [[probe:kgaps]]: the probe's code segment, its data segment and a block of its own each answer AX the handle and DX the selector; nought answers nought in both. The probe's exported prologue is three `nop`s before and after.

## Callers

- [[read out]] KERNEL's segment loader calls it for each code segment it loads (seg1 `7af3`). No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (a).** Both engines answer the handle in AX and its block's selector in DX, or nought (`PatchCodeHandle` in `crates/winbox-win16/src/kernel_calls/internals.rs`). WinBox's loader patches each code segment's prologues as it loads the module, as KERNEL's loader calls this for each segment it loads (`patchPrologues`, `patch_prologues`), so a call finds nothing left to patch. See [[topic:kernel-internals]].

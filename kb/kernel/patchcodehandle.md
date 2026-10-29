---
kind: function
module: KERNEL
name: PatchCodeHandle
ordinal: 110
summary: Fixes up the prologues of a loaded code segment's exported functions so that each loads its data segment; the segment loader calls it, and nothing else does.
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
- Not yet measured.

## Callers

- [[read out]] KERNEL's segment loader calls it for each code segment it loads (seg1 `7af3`). No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines. WinBox loads a program's segments itself. How it gives an exported function its data segment is the loader's own concern (`src/win16/loader.ts`).

**Recommendation: not needed as an export.** No program calls it. If WinBox's loader does not patch prologues as described, that is a loader question to settle with a probe of a program's exported callback, not a reason to export this. See [[topic:kernel-internals]].

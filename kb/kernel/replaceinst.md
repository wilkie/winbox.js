---
kind: function
module: KERNEL
name: ReplaceInst
ordinal: 201
summary: Nothing, in the retail Windows 3.1 — a bare RETF 6.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9ada`, `RETF 6`, three words popped and nothing else; `KRNL286.EXE` seg1 `9284` the same. AX and DX are left as they were.
- [[read out]] The code that follows at seg1 `9add`-`9bd7` is not part of it. That code is KERNEL's routine that puts its DOS hooks in. It sets the byte at 281h and makes KERNEL's own prefix current while it empties the keyboard's buffer through DOS. Then it makes the running task's prefix current, sets `INT 2Fh` to the vector kept at 300h, and sets interrupts 24h, 00h, 02h, 04h, 06h, 07h, 3Eh and 75h to its own handlers. Each vector is set by a call to DOS through the vector KERNEL keeps at 3Ch of its code ([[fn:KERNEL.GetSetKernelDOSProc]]).
- [[inferred]] The name and the three words suggest replacing an instruction at an address, in the way a debugger plants a breakpoint. The retail build keeps only the entry.
- [[measured]] [[probe:kintrnl]]: AX and DX kept, six bytes popped.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A retail no-op, popping six bytes (`nothing`). See [[topic:kernel-internals]].

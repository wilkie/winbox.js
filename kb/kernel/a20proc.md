---
kind: function
module: KERNEL
name: A20Proc
ordinal: 165
summary: Nothing, in Windows 3.1's protected-mode KERNELs — one word popped. Its name is the A20 address line's, which the DOS extender and HIMEM handle now.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9e0c`-`9e16`, `KRNL286.EXE` seg1 `9588`. It saves and restores BP, DS, SI and DI and returns with `RETF 2`. AX and DX are left as they were.
- [[inferred]] Switching the A20 line, the twenty-first address line that lets real mode reach the 64K above a megabyte, belongs to the DOS extender, to HIMEM.SYS and to WIN386 under Windows 3.1. KERNEL keeps the entry and does nothing in it.
- Not yet measured.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines, which pops the same two bytes.

**Recommendation: not applicable, kept as a no-op.** WinBox's machine has no A20 line to switch. A retail no-op popping two bytes is exact: one line in each engine. See [[topic:kernel-internals]].

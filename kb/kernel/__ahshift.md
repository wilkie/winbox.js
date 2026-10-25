---
kind: function
module: KERNEL
name: __AHSHIFT
ordinal: 113
summary: The number 3, how far to shift a count of 64 KiB pieces to step a huge pointer's selector. It is a number a program reads, not a function.
versions:
  '3.1': exact
probes: [kconst]
source: src/win16/kernel/constants.ts
topics: [exported-constants]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE`'s entry table holds 3 at this ordinal, in segment FEh, a constant.
- [[measured]] [[probe:kconst]]: 3, as the step is 8. [[fn:KERNEL.GetProcAddress]] answers FFFF0003h.

## Nuances

- [[read out]] The loader writes the number at an offset fixup, FFFFh at a selector fixup, and adds its low byte at a byte fixup (`KRNL386.EXE` seg1 `748d`-`74ef`). TOOLHELP adds `__AHINCR` to a byte.

## Implementation

A constant in KERNEL's export table, written where a program imports it in both engines. See [[topic:exported-constants]].

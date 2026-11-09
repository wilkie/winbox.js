---
kind: function
module: KERNEL
name: __AHINCR
ordinal: 114
summary: The number 8, what a huge pointer's selector goes up by at each 64 KiB. It is a number a program reads, not a function.
versions:
  '3.1': exact
probes: [kconst]
source: crates/winbox-win16/src/linker.rs
topics: [exported-constants]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE`'s entry table holds 8 at this ordinal, in segment FEh, a constant.
- [[measured]] [[probe:kconst]]: 8, one descriptor. [[fn:KERNEL.GetProcAddress]] answers FFFF0008h.

## Nuances

- [[read out]] The loader writes the number at an offset fixup, FFFFh at a selector fixup, and adds its low byte at a byte fixup (`KRNL386.EXE` seg1 `748d`-`74ef`). TOOLHELP adds `__AHINCR` to a byte.

## Implementation

A constant in KERNEL's export table, written where a program imports it in both engines. See [[topic:exported-constants]].

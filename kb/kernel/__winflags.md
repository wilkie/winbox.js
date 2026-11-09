---
kind: function
module: KERNEL
name: __WINFLAGS
ordinal: 178
summary: The flags GetWinFlags answers, as a number a program reads rather than a function it calls.
versions:
  '3.1': exact
probes: [kconst, winflags]
source: crates/winbox-win16/src/linker.rs
topics: [exported-constants]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE`'s entry table holds 1 at this ordinal, in segment FEh, a constant. KERNEL puts the flags there as it starts.
- [[measured]] [[probe:kconst]] and [[probe:winflags]]: 419h, as [[fn:KERNEL.GetWinFlags]] answers. [[fn:KERNEL.GetProcAddress]] answers FFFF0419h. In 386 enhanced mode, C29h and FFFF0C29h ([[guide:enhanced-mode]]); a WinBox machine made in that mode links and answers C29h.

## Nuances

- `COMMDLG.DLL`'s entry point and WIN87EM read it where they are linked. Without a coprocessor, bit 400h is clear.

## Implementation

A constant in KERNEL's export table, the low word of `GetWinFlags`. See [[topic:exported-constants]].

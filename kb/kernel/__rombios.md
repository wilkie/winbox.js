---
kind: function
module: KERNEL
name: __ROMBIOS
ordinal: 173
summary: A selector for the ROM BIOS at F0000h: the same selector as `__F000H`. It is a number a program reads, not a function.
versions:
  '3.1': exact
probes: [kconst]
source: crates/winbox-win16/src/linker.rs
topics: [exported-constants]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE`'s entry table holds F000h at this ordinal, in segment FEh, a constant. KERNEL puts a protected-mode selector for that paragraph there as it starts.
- [[measured]] [[probe:kconst]]: a selector in the local table at privilege 3 for a data segment of 64 KiB, writable and not yet accessed (`LAR` F200h). Its base is F0000h above [[fn:KERNEL.__0000H]]'s. [[fn:KERNEL.GetProcAddress]] answers it with FFFFh in the high word.
- [[measured]] [[probe:kconst]]: the same selector as [[fn:KERNEL.__F000H]].

## Implementation

The selector is one of the nine below the interrupt descriptor table's, which no block is given, and its base is in the megabyte winbox.js keeps for the first megabyte at FFE00000h. Both engines write it where a program imports it, as KERNEL's loader writes a constant. See [[topic:exported-constants]].

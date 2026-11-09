---
kind: function
module: KERNEL
name: SelectorAccessRights
ordinal: 196
summary: A selector's type and flags read, or set through DPMI.
versions:
  '3.1': exact
probes: [ktask]
records: [selector]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `279b`-`27cb`. `LAR` shifted down a byte gives the access byte and byte 6. For an operation of nought, that is answered masked with D01Eh: the type, granularity, size and the bit free for software. Otherwise those bits are taken from the rights given and the rest kept, set through DPMI's function 0009h, and nought is answered.
- [[measured]] [[probe:ktask]]: 12h for a data selector. Set to FFFFh it reads D01Eh. Set to 18h it reads 18h, its access byte F9h.

## Implementation

`crates/winbox-win16/src/modules_kernel.rs`.

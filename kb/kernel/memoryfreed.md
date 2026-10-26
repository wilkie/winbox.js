---
kind: function
module: KERNEL
name: MemoryFreed
ordinal: 126
summary: Nought, where KERNEL keeps no figures of memory swapped.
versions:
  '3.1': exact
probes: [ktask2]
records: [small]
source: src/win16/kernel/code-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `2ea7`-`2edb`: nought in DX and AX unless bit 4 of the byte at 327h of KERNEL's data is set.
- [[measured]] [[probe:ktask2]]: nought.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.

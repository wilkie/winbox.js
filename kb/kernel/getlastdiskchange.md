---
kind: function
module: KERNEL
name: GetLastDiskChange
ordinal: 98
summary: The drive whose disk was last changed, once; nought.
versions:
  '3.1': exact
probes: [ktask2]
records: [small]
source: src/win16/kernel/code-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `5c17`-`5c24`: the byte at 27Eh of KERNEL's data, exchanged for nought.
- [[measured]] [[probe:ktask2]]: nought.

## Nuances

- Not yet done: what sets the byte as a disk is changed.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.

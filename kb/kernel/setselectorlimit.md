---
kind: function
module: KERNEL
name: SetSelectorLimit
ordinal: 189
summary: A selector's limit set straight in its descriptor; nought.
versions:
  '3.1': exact
probes: [ktask]
records: [selector]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `276d`-`2798`: the low word of the limit into the descriptor, and the low four bits of its high word into byte 6. The granularity is left alone, and the answer is nought.
- [[measured]] [[probe:ktask]]: 12345h set and read back.

## Implementation

`src/win16/kernel/selector-aliases.ts`, and the Rust engine's `modules_kernel.rs`.

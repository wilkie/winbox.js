---
kind: function
module: KERNEL
name: SetSelectorBase
ordinal: 187
summary: A selector's base set straight in its descriptor; the selector.
versions:
  '3.1': exact
probes: [ktask]
records: [selector]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `2725`-`2752`: the base's three bytes written into the descriptor through KERNEL's alias of the local table. Nothing is checked, and the selector is answered.
- [[measured]] [[probe:ktask]]: on a selector from [[fn:KERNEL.AllocSelector]] of a block of 1000h bytes, the selector, and a base 10h on. The limit and rights are as they were.

## Implementation

`src/win16/kernel/selector-aliases.ts`, and the Rust engine's `modules_kernel.rs`.

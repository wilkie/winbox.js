---
kind: function
module: KERNEL
name: IsSharedSelector
ordinal: 345
summary: Whether a selector belongs to a library.
versions:
  '3.1': exact
probes: [ktask]
records: [module]
source: src/win16/kernel/module-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `4d39`-`4d59`: the module [[fn:KERNEL.GetExePtr]] finds for the selector, and 1 where bit 15 of its flags, NE 0Ch, is set. A library's selectors are shared by every task.
- [[measured]] [[probe:ktask]]: nought for the probe's data segment and a block of its own, 1 for USER's instance.

## Implementation

`src/win16/kernel/module-calls.ts`, and the Rust engine's `kernel_calls/tasks.rs`.

---
kind: function
module: KERNEL
name: GetExePtr
ordinal: 133
summary: The module a handle belongs to: a module's own, a task instance's, or the owner of a block.
versions:
  '3.1': exact
probes: [ktask]
records: [module, identity]
source: src/win16/kernel/module-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `4e78`-`4eff`. An odd handle with `NE` at its start is a module's own handle, and is answered as it is. Otherwise a task whose instance (TDB 1Ch) is the handle gives its module (TDB 1Eh). Otherwise the owner of the block the handle names is answered where it is a module, or the module of the task whose prefix it is. Anything else is nought.
- [[measured]] [[probe:ktask]]: the probe's module for its instance, its module, a block of its own and its code segment. USER's module for USER's. Nought for 1234h and for the probe's task.

## Implementation

`src/win16/kernel/module-calls.ts`, and the Rust engine's `kernel_calls/tasks.rs`.

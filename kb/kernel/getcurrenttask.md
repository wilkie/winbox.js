---
kind: function
module: KERNEL
name: GetCurrentTask
ordinal: 36
summary: The running task's handle, and in DX the first task in KERNEL's list.
versions:
  '3.1': exact
probes: [ktask]
records: [task]
source: src/win16/kernel/tasks.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `842c`-`843c`: AX the word at 228h of KERNEL's data, the running task, and DX the word at 226h, the head of its list of tasks.
- [[measured]] [[probe:minis]]: the task the probe's windows belong to. [[probe:ktask]]: with one task running, DX is that task too.

## Implementation

`src/win16/kernel/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/tasks.rs`.

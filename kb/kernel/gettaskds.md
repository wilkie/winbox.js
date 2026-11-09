---
kind: function
module: KERNEL
name: GetTaskDS
ordinal: 155
summary: The running task's instance, its data segment's handle, in AX and in DX.
versions:
  '3.1': exact
probes: [ktask]
records: [task]
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `119f`-`11af`: the word at 1Ch of the running task's database, its instance, in AX and DX.
- [[measured]] [[probe:ktask]]: the probe's instance, in both.

## Implementation

`crates/winbox-win16/src/kernel_calls/tasks.rs`.

---
kind: function
module: KERNEL
name: GetExeVersion
ordinal: 105
summary: The Windows version the running task's program was made for.
versions:
  '3.1': exact
probes: [ktask]
records: [module]
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `07d9`-`07e5`: the word at 1Ah of the running task's database, which KERNEL copies from the module as it makes the task.
- [[measured]] [[probe:ktask]]: 300h for the probe, which Watcom links as a program for Windows 3.0. That is what [[fn:KERNEL.GetExpWinVer]] answers for its module.

## Implementation

`crates/winbox-win16/src/kernel_calls/tasks.rs`.

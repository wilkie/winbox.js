---
kind: function
module: KERNEL
name: SetPriority
ordinal: 32
summary: A task's priority moved by an amount, held to -32 to 15; the new priority.
versions:
  '3.1': exact
probes: [ktask]
records: [task]
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7df0`-`7e3b`: the low byte of the change added to the priority, the byte at 8 of the task's database, and held to -32 and 15. Unless the priority is unchanged and the task is running, the task is taken out of KERNEL's list and put back. With a new priority it goes after the others of that priority, since it is put in as though one more; with the same one it goes before them. The answer is the new priority, widened from its byte.
- [[measured]] [[probe:ktask]]: from nought, by 32 is 15, by -100 is -32, by 100 is 15, by -5 is 10 and by 5 is 15. Watcom evaluates the probe's arguments from the last, so the calls ran in that order.

## Implementation

`src/win16/kernel/task-calls.ts`, and the Rust engine's `kernel_calls/tasks.rs and task_order.rs`.

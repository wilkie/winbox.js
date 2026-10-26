---
kind: function
module: KERNEL
name: SetTaskQueue
ordinal: 34
summary: A task given a queue; the queue it had.
versions:
  '3.1': exact
probes: [ktask]
records: [task]
source: src/win16/kernel/task-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7de3`: the word at 20h of the task's database exchanged.
- [[measured]] [[probe:ktask]]: it answers the queue the task had, and `GetTaskQueue` then answers the one given, 1234h.

## Implementation

`src/win16/kernel/task-calls.ts`, and the Rust engine's `kernel_calls/tasks.rs`.

---
kind: function
module: KERNEL
name: GetTaskQueue
ordinal: 35
summary: A task's message queue, nought for the running task's.
versions:
  '3.1': exact
probes: [ktask]
records: [task]
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7d9d`: the word at 20h of the task's database. Nought names the running task (`7d7c`).
- [[measured]] [[probe:ktask]]: the queue TOOLHELP's `TASKENTRY` gives for the probe.

## Implementation

USER makes the queue as the task calls `InitApp`. winbox.js keeps a task's messages itself and has no block for them, so it makes a block of nothing the first time a task's queue is asked for, and answers its selector (`queueOf`). Not yet done: before `InitApp`, Windows answers nought.

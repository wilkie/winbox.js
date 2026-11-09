---
kind: function
module: KERNEL
name: GetTaskQueueDS
ordinal: 118
summary: DS made the running task's queue, AX and DX left as they were.
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7da7`-`7db4`: DS loaded from the word at 20h of the running task's database. Nothing else changes.
- Not yet measured.

## Implementation

The queue is the selector `GetTaskQueue` answers, loaded into DS.

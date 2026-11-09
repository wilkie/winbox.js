---
kind: function
module: KERNEL
name: GetTaskQueueES
ordinal: 119
summary: ES made the running task's queue, AX and DX left as they were.
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7db5`-`7dc4`: ES loaded from the word at 20h of the running task's database.
- Not yet measured.

## Implementation

`crates/winbox-win16/src/kernel_calls/tasks.rs`.

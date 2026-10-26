---
kind: function
module: KERNEL
name: PostEvent
ordinal: 31
summary: An event counted for a task; the task's handle.
versions:
  '3.1': exact
probes: [ktask]
records: [task]
source: src/win16/kernel/task-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7d92`-`7d9a`: the word at 6 of the task's database counted up. AX is left holding the task's handle, so that is the answer.
- [[measured]] [[probe:ktask]]: the probe's task answered, and TOOLHELP's `wcEvents` up from nought to 1.

## Nuances

- [[measured]] A `WaitEvent` after it hung the oracle's probe, so the probe no longer calls it. How `WaitEvent` takes an event is not yet recorded. winbox.js's `WaitEvent` still answers at once.

## Implementation

`src/win16/kernel/task-calls.ts`, and the Rust engine's `kernel_calls/tasks.rs`.

---
kind: function
module: KERNEL
name: IsTask
ordinal: 320
summary: The handle given where it names a task, else nought; not TRUE.
versions:
  '3.1': exact
probes: [ktask]
records: [task, identity]
source: src/win16/kernel/task-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7e50`-`7e74`: a handle that is not nought, whose selector's limit is FCh or more, with `TD` at FAh, is answered as it is. Anything else is nought.
- [[measured]] [[probe:ktask]]: the probe's task for its task, nought for nought. [[probe:thtask]]: a program ended with `TerminateApp` is no task after.

## Nuances

- [[measured]] On Windows a task's instance is not its task: `IsTask` of the probe's instance is nought. winbox.js's task handles are of their own too, and agree.

## Implementation

`src/win16/kernel/task-calls.ts`, and the Rust engine's `kernel_calls/tasks.rs`.

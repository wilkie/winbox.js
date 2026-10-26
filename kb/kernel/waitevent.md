---
kind: function
module: KERNEL
name: WaitEvent
ordinal: 30
summary: A task's event taken -- nought where it had one; else the processor given up until one is posted, FFh.
versions:
  '3.1': exact
probes: [kevent]
records: [pending, child, wait]
source: src/win16/kernel/task-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7ca8`-`7cfc`. The word at 6 of the task's database is counted down with the interrupts off; where it was more than nought, AX is nought. Where it was nought it is left at nought, the processor is given up (`802e`), and as the task comes back AL is FFh and the count is tried again.
- [[read out]] `LoadModule` gives a task it makes one event (seg2 `1383`), which a program's start-up takes with `WaitEvent(0)`.
- [[measured]] [[probe:kevent]]: after two `PostEvent`s, two `WaitEvent`s answer nought and leave one and then none; a program started from the probe finds none at its `WinMain`; with none pending, the probe's `WaitEvent` answers FFh once the program posts it one, and leaves none.

## Nuances

- Under Windows USER waits for messages this way, setting a mask of what wakes the task and posting it an event as such a message comes (`USER.EXE` seg1 `3d31`-`3da3`). WinBox's USER waits in its own way, and only [[fn:KERNEL.PostEvent]] gives a task an event; a program waiting in `WaitEvent` itself is woken by nothing else, as under Windows, where USER posts only to a task waiting in its own wait.

## Implementation

`src/win16/kernel/task-calls.ts` (the first event in `task-order.ts`), and the Rust engine's `kernel_calls/tasks.rs` (`task_order.rs`).

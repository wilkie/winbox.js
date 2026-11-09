---
kind: function
module: KERNEL
name: PostEvent
ordinal: 31
summary: An event counted for a task; the task's handle.
versions:
  '3.1': exact
probes: [ktask, kevent]
records: [task, pending]
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `7d92`-`7d9a`: the word at 6 of the task's database counted up. AX is left holding the task's handle, so that is the answer.
- [[measured]] [[probe:ktask]]: the probe's task answered, and TOOLHELP's `wcEvents` up from nought to 1.

- [[measured]] [[probe:kevent]]: two posted count two, which [[fn:KERNEL.WaitEvent]] takes one at a time; a task waiting in `WaitEvent` with none goes on once another posts it one.

## Nuances

- A task waiting in `WaitEvent` for one of its events is woken by it in WinBox: the record keeps which tasks wait.

## Implementation

`crates/winbox-win16/src/kernel_calls/tasks.rs`.

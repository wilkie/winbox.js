---
kind: function
module: TOOLHELP
name: TaskSetCSIP
ordinal: 81
summary: Where a task will go on from changed; the old place, or nought for the running task.
versions:
  '3.1': exact
probes: [thswch]
records: [set, child]
source: crates/winbox-win16/src/toolhelp/tasks.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0d68`-`0d94`: nought for the running task; else the CS and IP in the frame its switch left on its stack (its SS:SP at TDB 2) exchanged for those given, the old answered, IP in AX and CS in DX.
- [[measured]] [[probe:thswch]]: for a program waiting in `GetMessage`, the answer is what [[fn:TOOLHELP.TaskGetCSIP]] gave, which then gives the place set; nought for the probe's own task. Posted a message, the program goes to the procedure set, and ends there.

## Nuances

- In WinBox a task waiting in a call of the API is where that call will come back to: the call comes back first -- `GetMessage` takes its message -- and the task goes on from the place set.

## Implementation

`src/win16/toolhelp/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/tasks.rs` (the frame in the scheduler's saved context).

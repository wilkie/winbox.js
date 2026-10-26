---
kind: function
module: TOOLHELP
name: TaskSwitch
ordinal: 83
summary: A task sent somewhere else and run there at once; TRUE, or nought for the running task.
versions:
  '3.1': exact
probes: [thswch]
records: [switch, child]
source: src/win16/toolhelp/tasks.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0dc0`-`0e62`. Nought where TOOLHELP was not set up with KERNEL, for the running task, or for a handle that is no task (`TD` at FAh). Otherwise [[fn:TOOLHELP.TaskSetCSIP]] sends the task to TOOLHELP's own code at `0e34`, the place given kept in TOOLHELP's data; the task is given an event and [[fn:KERNEL.DirectedYield]] runs it. At `0e34` it takes the event back and goes on to the place given, its registers as they were. The answer is one.
- [[measured]] [[probe:thswch]]: a program giving the processor up with `Yield` goes to the procedure given -- its record written -- before `TaskSwitch` comes back, one; it ends there. Nought for the probe's own task.

## Nuances

- WinBox sets the place itself, with no code of TOOLHELP's between; the event given and taken back cancel out. A task waiting for a message in WinBox goes there only once its wait is over, as [[fn:TOOLHELP.TaskSetCSIP]]'s does.

## Implementation

`src/win16/toolhelp/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/tasks.rs`.

---
kind: function
module: TOOLHELP
name: TaskGetCSIP
ordinal: 82
summary: Where a task will go on from when it next runs; nought for the running task.
versions:
  '3.1': exact
probes: [thtask]
records: [child]
source: src/win16/toolhelp/tasks.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0d97`-`0dbd`: nought for the running task. For another, the CS:IP at 12h and 14h of the frame KERNEL's switch left at the task's SS:SP.
- [[measured]] [[probe:thtask]]: not nought for a program waiting in its message loop, nought for the probe.

## Implementation

`src/win16/toolhelp/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

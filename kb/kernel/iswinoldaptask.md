---
kind: function
module: KERNEL
name: IsWinOldApTask
ordinal: 158
summary: Whether a task runs a DOS program in a window under WinOldAp; undocumented.
versions:
  '3.1': exact
probes: [tasklist]
source: src/win16/kernel/tasks.ts
topics: [task-list]
---

## Observed behaviour

[[read out]] `KRNL386.EXE` seg1 `7e3e` answers bit 0 of the word at `48h` of the task's module database.

[[measured]] The Task List's End Task asks it of the task of the window chosen, and switches to that window first only where it answers nought ([[probe:tasklist]]). For the probe, a Windows program, it switched.

winbox.js runs no DOS program, and answers FALSE for every task. It was a stub that left AX as it was, so in the Rust engine End Task did not switch.

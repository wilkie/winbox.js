---
kind: function
module: TOOLHELP
name: TerminateApp
ordinal: 77
summary: A task ended through FatalAppExit -- its Application Error box, Closing current application., unless NO_UAE_BOX.
versions:
  '3.1': exact
probes: [thtask]
records: [child]
source: src/win16/toolhelp/misc.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `26ea`-`27a0`. The task is switched to first unless it is running; `NO_UAE_BOX` (bit 0) sets bit 1 of TDB 18h; and `FatalAppExit(0, NULL)` is called (`275a`-`2760`), which shows the "Application Error" box with KERNEL's "Closing current application." unless that bit is set, and ends the task through `INT 21h` 4CFFh ([[fn:KERNEL.FatalAppExit]]). Only were it to come back would `wFlags`' bit 15 be looked at, and the task's signal procedure be told before its own 4CFFh.
- [[measured]] [[probe:thtask]]: a program of the probe's own, ended with `NO_UAE_BOX`, is no task after, and its window is gone.

## Nuances

- WinBox shows the box from the task that called, not from the task being ended, then ends that task.

## Implementation

`src/win16/toolhelp/misc.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

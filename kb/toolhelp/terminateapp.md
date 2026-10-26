---
kind: function
module: TOOLHELP
name: TerminateApp
ordinal: 77
summary: A task ended, with no Application Error box for NO_UAE_BOX.
versions:
  '3.1': exact
probes: [thtask]
records: [child]
source: src/win16/toolhelp/misc.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `26ea`-`27a0`. The task is switched to first unless it is running, `NO_UAE_BOX` sets bit 2 of TDB 18h, and `FatalAppExit` is called. Unless `wFlags` has bit 15, the task's signal procedure is told and the task ends through `INT 21h` 4CFFh.
- [[measured]] [[probe:thtask]]: a program of the probe's own, ended with `NO_UAE_BOX`, is no task after, and its window is gone.

## Implementation

`src/win16/toolhelp/misc.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

---
kind: function
module: KERNEL
name: IsTaskLocked
ordinal: 122
summary: The task LockCurrentTask locked, or nought.
versions:
  '3.1': exact
probes: [lockinp]
source: src/win16/kernel/tasks.ts
topics: [system-queue]
---

## Observed behaviour

[[read out]] `KRNL286.EXE` seg1 `79f3` answers the word at 22Ch of KERNEL's data, which [[fn:KERNEL.LockCurrentTask]] sets.

[[measured]] [[probe:lockinp]]: nought before [[fn:USER.LockInput]] locks; the probe's own task while it does; nought after.

Both engines followed none of this before: it was a stub.

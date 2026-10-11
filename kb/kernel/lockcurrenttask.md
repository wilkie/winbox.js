---
kind: function
module: KERNEL
name: LockCurrentTask
ordinal: 33
summary: Locks the running task, so the scheduler switches to no other, or lets it go; answers the task locked.
versions:
  '3.1': exact
probes: [lockinp]
source: src/win16/kernel/tasks.ts
topics: [system-queue]
---

## Observed behaviour

[[read out]] `KRNL286.EXE` seg1 `79d9` keeps the running task at 22Ch of KERNEL's data where it is given non-nought, and nought otherwise, and answers what it kept. KERNEL's scheduler, looking for a task to switch to, stops at the first with something to do; where that is not the locked task, it switches to none (`7912`-`791b`). So no other task runs while one is locked, however it is woken. [[fn:KERNEL.IsTaskLocked]] answers the task.

[[measured]] [[probe:lockinp]], through [[fn:USER.LockInput]]: while locked, a second program posted a message does not answer it, though the probe looks for messages and yields twenty times; let go, it answers.

Both engines followed none of this before: it was a stub.

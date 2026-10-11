---
kind: function
module: USER
name: LockMyTask
ordinal: 276
summary: Locks the running program, so no other runs and its looks for messages do not yield; or lets it go. Undocumented.
versions:
  '3.1': exact
probes: [gmhook, lockinp]
source: src/win16/user/lock-input.ts
topics: [system-queue]
---

## Observed behaviour

[[read out]] `USER.EXE` seg1 `6eea` does nothing while [[fn:USER.LockInput]] has the input locked. Otherwise it calls [[fn:KERNEL.LockCurrentTask]] with what it is given, and keeps it at `0DEh` of USER's data. While that is set, each look of the program's -- `GetMessage`, `PeekMessage` -- is made as with `PM_NOYIELD` (`245b`-`2462`). Locking, it lets the system queue's input go, from whatever program held it (`6f0c`-`6f1b`). [[fn:USER.SysErrorBox]] locks so while its box is up (`935d`).

[[measured]] [[probe:gmhook]]: locked, `PeekMessage` with `PM_REMOVE` hands the message hooks 3, `PM_NOYIELD` added. [[topic:system-queue]] has the rest.

Both engines followed none of this before: it was a stub.

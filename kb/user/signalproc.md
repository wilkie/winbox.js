---
kind: function
module: USER
name: SignalProc
ordinal: 314
summary: KERNEL's notices to USER: a task's end, a module loaded or freed; a loaded module's icon and cursor resource handlers set.
probes: [userproc]
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]]: `SetResourceHandler` answers [[fn:USER.LoadDibIconHandler]]'s address for the probe's icons -- set by this procedure as the module was loaded; the group icons keep KERNEL's own.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `09bc`-`0a5c`: four arguments, the handle, the signal, a word and a double word; nought answered. Signal 20h, and 666h with a flag, `0b71` with the handle and the double word: the task's end, its windows, hooks and queue. Signal 40h, a module loaded: `SetResourceHandler` of its `RT_CURSOR` and `RT_ICON` types -- [[fn:USER.LoadDibCursorHandler]] and [[fn:USER.LoadDibIconHandler]] where `GetExpWinVer` is 300h or more, else [[fn:USER.LoadCursorIconHandler]] for both. Signal 80h, a module freed: `1088` with the handle.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

A stub in both engines. **Not yet done**: WinBox's KERNEL and USER are one program and do a task's end themselves; the handlers of signal 40h wait on the handlers' own conversion (below).

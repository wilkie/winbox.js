---
kind: function
module: USER
name: SignalProc
ordinal: 314
summary: KERNEL's notices to USER: a task's end, a module loaded or freed; a loaded module's icon and cursor resource handlers set.
probes: [iconhand, userproc]
records: [signal, handler]
source: src/win16/user/icon-handlers.ts
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]], [[probe:iconhand]]: `SetResourceHandler` answers [[fn:USER.LoadDibIconHandler]]'s address for a program's icons and [[fn:USER.LoadDibCursorHandler]]'s for its cursors -- set by this procedure as the module was loaded; the groups keep KERNEL's own.
- [[measured]] [[probe:iconhand]]: called by a program with its instance and 40h, after it set a handler of its own for its icons, it answers nought in AX, and the icons' handler is USER's again.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `09bc`-`0a5c`: four arguments, the handle, the signal, a word and a double word; nought answered in AX. Signal 20h, and 666h with a flag, `0b71` with the handle and the double word: the task's end, its windows, hooks and queue. Signal 40h, a module loaded: `SetResourceHandler` of its `RT_CURSOR` and `RT_ICON` types -- [[fn:USER.LoadDibCursorHandler]] and [[fn:USER.LoadDibIconHandler]] where `GetExpWinVer` is 300h or more, else [[fn:USER.LoadCursorIconHandler]] for both. Signal 80h, a module freed: `1088` with the handle.

## Implementation

`src/win16/user/icon-handlers.ts`; the Rust engine's `icon_handlers.rs`. Signal 40h as Windows does it. WinBox sets USER's handlers on a module's icons and cursors itself, as the module's handlers are first asked for (`resource-handlers.ts`), where KERNEL would signal it loaded. **Not yet done**: signals 20h, 666h and 80h do nothing -- WinBox's KERNEL and USER are one program and do a task's end and a module's freeing themselves.

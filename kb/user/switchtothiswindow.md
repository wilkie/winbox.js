---
kind: function
module: USER
name: SwitchToThisWindow
ordinal: 172
summary: Brings a window to the top and makes it active, as the Task List and the hot keys switch programs; undocumented.
versions:
  '3.1': exact
probes: [tasklist, hotkey]
source: src/win16/user/task-list.ts
topics: [task-list]
---

## Observed behaviour

[[read out]] `USER.EXE` seg23 `0ceb` takes the window and whether the switch is by Alt and Tab. It brings the window to the top with the deferred [[fn:USER.SetWindowPos]], `HWND_TOP`, its place and size left alone, which makes it active. A switch not by Alt and Tab also sends the window that was active to the bottom, without activating it. That is skipped where the window is topmost, or where Alt and Escape would find no other window to switch to (seg23 `0c58`). A switch by Alt and Tab sends a window minimized `WM_SYSCOMMAND` with `SC_RESTORE`. It answers nothing.

[[measured]] The Task List's Switch To and End Task call it as by Alt and Tab ([[probe:tasklist]]), and so does `DefWindowProc` for a hot key ([[probe:hotkey]]). A window chosen there is active after. One minimized is sent `SC_RESTORE` with an `lParam` of nought, and restored.

Both engines followed none of this before: it was a stub. [[topic:task-list]] has the rest.

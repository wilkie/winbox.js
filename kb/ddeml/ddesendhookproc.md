---
kind: function
module: DDEML
name: DDESENDHOOKPROC
ordinal: 34
summary: DDEML's WH_CALLWNDPROC hook, put in with the first monitor: each DDE message sent, told to the monitors as MF_SENDMSGS.
versions:
  '3.1': unrecorded
source: src/win16/ddeml/monitor.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `2fb0`: for a message from 3E0h to 3E8h, a `MONMSGSTRUCT` of 18 bytes -- the window it went to, the time, that window's task, the message and its parameters -- sent to the monitors that take `MF_SENDMSGS`; then on with [[fn:USER.DefHookProc]]. [[fn:DDEML.DdeInitialize]] puts it in with the first monitor and [[fn:DDEML.DdeUninitialize]] takes it out with the last, by [[fn:USER.SetWindowsHook]] and [[fn:USER.UnhookWindowsHook]].

Not yet recorded: [[probe:ddemgmt]]'s monitor does not ask for `MF_SENDMSGS`.

## Implementation

WinBox's own: `sendHook` in `src/win16/ddeml/monitor.ts` and `send_hook` in `crates/winbox-win16/src/ddeml/monitor.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, put in by [[fn:USER.SetWindowsHook]] as the first monitor is made. Not yet recorded.

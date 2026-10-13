---
kind: function
module: DDEML
name: DDESENDHOOKPROC
ordinal: 34
summary: DDEML's WH_CALLWNDPROC hook, put in with the first monitor: each DDE message sent, told to the monitors as MF_SENDMSGS.
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `2fb0`: for a message from 3E0h to 3E8h, a `MONMSGSTRUCT` of 18 bytes -- the window it went to, the time, that window's task, the message and its parameters -- sent to the monitors that take `MF_SENDMSGS`; then on with [[fn:USER.DefHookProc]]. [[fn:DDEML.DdeInitialize]] puts it in with the first monitor and [[fn:DDEML.DdeUninitialize]] takes it out with the last, by [[fn:USER.SetWindowsHook]] and [[fn:USER.UnhookWindowsHook]].

Not yet recorded: [[probe:ddemgmt]]'s monitor does not ask for `MF_SENDMSGS`.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.

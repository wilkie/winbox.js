---
kind: function
module: DDEML
name: DDEPOSTHOOKPROC
ordinal: 35
summary: DDEML's WH_GETMESSAGE hook, put in with the first monitor: each DDE message a task takes from its queue, told to the monitors as MF_POSTMSGS.
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `309e`: for a message from 3E0h to 3E8h, a `MONMSGSTRUCT` -- the message's own time -- sent to the monitors that take `MF_POSTMSGS`; then on with [[fn:USER.DefHookProc]]. A posted message is told as it is taken, by `GetMessage` or `PeekMessage`, not as it is posted. Both of DDEML's hooks keep the hook before them in one word, `[3Ah]`, so the second put in, this one first, has its own overwritten.

Not yet recorded: [[probe:ddemgmt]]'s monitor does not ask for `MF_POSTMSGS`.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.

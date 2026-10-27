---
kind: function
module: GDI
name: SetDCHook
ordinal: 190
summary: Sets the procedure GDI calls before it uses a device context, and the dword passed to it; answers 1.
versions:
  '3.1': partial
probes: [dcinner, dchook]
topics: [device-context-internals]
---

## Observed behaviour

- [[measured]] It answers 1, with the data's high word in DX: CAFE0001h for data CAFE1234h ([[probe:dcinner]]).
- [[measured]] [[fn:GDI.GetDCHook]] then gives back the procedure and the data.
- [[measured]] A procedure of nought clears the flag [[fn:GDI.SetHookFlags]] sets: the next `SetHookFlags` answers 2.
- [[measured]] With the flag set, GDI calls the procedure once from each call that uses the context — `GetClipBox`, `GetTextColor`, `Rectangle` — with the context, 1 (`DCHC_INVALIDVISRGN`), the data and nought ([[probe:dchook]]). The flag stays set.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `04ec` keeps the procedure at the context's C4h and the data at C8h, and clears bit 2 of the byte at 0Ah where the procedure is nought. That bit is what the validation of a context tests: where it is set, seg1 `4423` calls seg1 `43f3`, which calls the procedure through C4h with the context, the code, the data and nought.

## Implementation

In both engines the procedure, the data and the flag are kept and answered as read out, and GDI calls the procedure, where the flag is set, before each of its calls that use the context: a program's through the processor, USER's `DCHOOK` run by WinBox itself ([[fn:USER.DCHook]]). Which calls call it is read out in [[topic:visible-regions]]; those not read out one by one are taken to call it as the rest that use the context do [[inferred]]. `DeleteDC`'s call with `DCHC_DELETEDC` is not followed. [[probe:dcinner]] and [[probe:dchook]] agree in both.

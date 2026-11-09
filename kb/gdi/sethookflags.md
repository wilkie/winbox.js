---
kind: function
module: GDI
name: SetHookFlags
ordinal: 192
summary: Sets or clears the flag that has GDI call a device context's hook; answers whether it was set.
versions:
  '3.1': exact
probes: [dcinner, visfam]
topics: [device-context-internals]
---

## Observed behaviour

- [[measured]] It answers 1 where the flag was set and 2 where it was not, in DX as well as AX ([[probe:dcinner]]).
- [[measured]] 1 (`DCHF_INVALIDATEVISRGN`) sets it; 0 and 2 clear it. It can be set with no hook.
- [[measured]] A window's device context has it clear.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `76b0`: bit 2 of the context's byte at 0Ah, set where the flags' bit 0 is and cleared otherwise; the answer, 1 or 2, is made in DX and copied to AX.

## Implementation

As read out. With the flag set, GDI calls the hook before the next call that uses the context ([[fn:GDI.SetDCHook]]); on a context USER lends, USER's hook works its visible region out again ([[fn:USER.DCHook]]; [[probe:visfam]], `hook`). [[probe:dcinner]] agrees in both.

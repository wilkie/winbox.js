---
kind: function
module: KERNEL
name: __GP
ordinal: 342
summary: KERNEL's own table of the parts of its code that handle a general protection fault. It is data, not a function, and WinBox leaves it.
topics: [kernel-internals, exported-constants]
---

## Observed behaviour

- [[read out]] The entry is in KERNEL's code segment, `KRNL386.EXE` seg1 `a820` (`KRNL286.EXE` seg1 `97d0`). What is there is a table of words, not code. It holds records of four words: a selector, filled in by the loader's relocations; the first offset of a range; the offset past its end; and the offset of the code that handles a fault in that range. For example, seg1 `a820` holds F7h, 101h and 103h. The table ends at a selector of nought.
- [[read out]] [[fn:KERNEL.HasGPHandler]] reads such a table. It looks for an export named `__GP` in the module that owns the faulting code, and trusts the table only for `GDI`, `USER`, `KERNEL`, `PENWIN`, `DISPLAY` and `MMSYSTEM`. `USER.EXE` exports its own `__GP` at ordinal 484 and `GDI.EXE` at ordinal 46 (`kb/data/exports-3.1.json`).
- [[inferred]] The ranges are the places where KERNEL, USER and GDI touch memory a program passed them and might fault. The handler is the code that turns a fault there into an error return rather than an Application Error.
- Not yet measured.

## Callers

- Nothing imports it. KERNEL finds it by name through [[fn:KERNEL.HasGPHandler]] (`kb/data/kernel-callers.json`).

## Implementation

Named in KERNEL's table and left. WinBox has no KERNEL code for such a table to describe, and no program imports KERNEL's. See [[topic:exported-constants]].

**Recommendation: not applicable.** It describes Windows' own code. If [[fn:KERNEL.HasGPHandler]] answers nought, as recommended there, nothing reads it. See [[topic:kernel-internals]].

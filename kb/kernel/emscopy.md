---
kind: function
module: KERNEL
name: EMSCopy
ordinal: 160
summary: Nothing, in Windows 3.1's protected-mode KERNELs — a frame made and undone, fourteen bytes popped. Left from the real-mode KERNEL's expanded memory.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `a940`-`a94a`, `KRNL286.EXE` seg1 `98f0`. It saves BP, DS, SI and DI, restores them and returns with `RETF 0Eh`, seven words popped. AX and DX are left as they were.
- [[inferred]] The name and the seven words are those of a copy into or out of expanded memory. Windows 3.1 runs only in protected mode, standard or enhanced, and its KERNEL no longer manages EMS itself, so nothing is left to do. [[fn:KERNEL.LimitEmsPages]] is a no-op for the same reason ([[topic:kernel-queries]]).
- Not yet measured.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines, which pops the same fourteen bytes.

**Recommendation: implement as a no-op.** Move it to the retail no-ops, popping fourteen bytes: one line in each engine. WinBox has no expanded memory, and Windows 3.1 does nothing here either. See [[topic:kernel-internals]].

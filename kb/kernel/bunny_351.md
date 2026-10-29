---
kind: function
module: KERNEL
name: BUNNY_351
ordinal: 351
summary: Called by USER's ExitWindows; changes what KERNEL does with a fault nobody handles, so that a system debugger, if there is one, is told before the Application Error path is taken.
topics: [kernel-internals, application-errors]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `5e92`-`5e9f` (`KRNL286.EXE` seg1 `572b`, the word there at AC0h). No arguments, nothing popped, AX and DX kept. It writes 5E87h to the word at B80h of KERNEL's data.
- [[read out]] That word is the routine KERNEL's fault handler calls last, when no `__GP` table ([[fn:KERNEL.HasGPHandler]]), no TOOLHELP and no debugger hook took the fault (seg1 `5e2c`-`5e76`). The file starts it at 5EACh. That is the Application Error path: the box, or a return to a place saved at 3D4h and 3D6h if the fault is on that stack (seg1 `5eac`-`5eee`).
- [[read out]] 5E87h, the routine `BUNNY_351` puts there, first tests bit 3 of the byte at 328h, a system debugger present. If it is set, the fault is passed to that debugger with `INT 41h` AX=40h, CS:IP in CX:BX, and nothing more is done. Otherwise it goes on to 5EACh as before (seg1 `5e7b`-`5e90`).
- [[read out]] While the fault handler runs, it puts 5EA1h there, the same test, so that a fault inside the handler reaches a debugger too. On its way out it puts back what was there before (seg1 `5e31`, `5e76`).
- [[inferred]] Once Windows is ending, a fault no program handles should go straight to a system debugger rather than to USER's box, which can no longer be shown. Without a debugger the change makes no difference.
- Not yet measured.

## Callers

- [[read out]] `USER.EXE`'s `ExitWindows` calls it once its windows and tasks are gone, before GDI's `Death` and [[fn:KERNEL.ExitKernel]] (USER seg5 `0361`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).
- The name is Windows' own, in KERNEL's name table. It says nothing about what the call does.

## Implementation

A stub in both engines, which pops nothing.

**Recommendation: implement as a no-op.** WinBox has no system debugger to tell, so the change it makes never shows. A retail no-op is exact: one line in each engine. See [[topic:kernel-internals]].

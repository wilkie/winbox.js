---
kind: function
module: KERNEL
name: EMSCopy
ordinal: 160
summary: Left from the real-mode KERNEL's expanded memory; its entry lies past the end of KERNEL's code once Windows has started, so a call to it faults.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `a940`-`a94a`, `KRNL286.EXE` seg1 `98f0`. It saves BP, DS, SI and DI, restores them and returns with `RETF 0Eh`, seven words popped, AX and DX left as they were. That is the file; the next two points say why a program never runs it.
- [[inferred]] The name and the seven words are those of a copy into or out of expanded memory. Windows 3.1 runs only in protected mode, standard or enhanced, and its KERNEL no longer manages EMS itself, so nothing is left to do. [[fn:KERNEL.LimitEmsPages]] is a no-op for the same reason ([[topic:kernel-queries]]).
- [[read out]] The routine is never reached once Windows has started. Its entry, `a940`, is where KERNEL cuts its first code segment as start-up ends: seg1 `b565`-`b573` calls seg1 `0d68` with the segment and a size of A940h. Everything from there on is code for starting alone.
- [[measured]] [[probe:emscopy]]: the entry's selector has a limit of A93Fh, so the entry is past it. Called with seven words, the far call faults. Windows carries on: AX is 81h, DX kept, and six bytes are popped, eight left on the stack. What KERNEL's fault handling does to come back so is not read out.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines, which pops fourteen bytes and leaves nought. It is not a no-op, because Windows' answer is that of a fault at a call past the end of KERNEL's code, not the routine in the file. [[probe:emscopy]] is a known gap. Matching it means reading what KERNEL's fault handler does with a far call past a segment's limit. See [[topic:kernel-internals]].

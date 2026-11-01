---
kind: function
module: KERNEL
name: EMSCopy
ordinal: 160
summary: Left from the real-mode KERNEL's expanded memory; its entry lies past the end of KERNEL's code once Windows has started, so a call to it runs whatever lies there -- under DOSBox, MMSYSTEM's timeGetSystemTime.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `a940`-`a94a`, `KRNL286.EXE` seg1 `98f0`. It saves BP, DS, SI and DI, restores them and returns with `RETF 0Eh`, seven words popped, AX and DX left as they were. That is the file; the next points say why a program never runs it.
- [[inferred]] The name and the seven words are those of a copy into or out of expanded memory. Windows 3.1 runs only in protected mode, standard or enhanced, and its KERNEL no longer manages EMS itself, so nothing is left to do. [[fn:KERNEL.LimitEmsPages]] is a no-op for the same reason ([[topic:kernel-queries]]).
- [[read out]] The routine is never reached once Windows has started. Its entry, `a940`, is where KERNEL cuts its first code segment as start-up ends: seg1 `b565`-`b573` calls seg1 `0d68` with the segment and a size of A940h. Everything from there on is code for starting alone.
- [[measured]] [[probe:emscopy]]: the entry's selector has a limit of A93Fh, so the entry is past it. Called with seven words, the call comes back with AX 81h, DX kept, and six bytes popped, eight left on the stack.
- [[measured]] [[probe:emspast]] finds why. The linear address of the entry lies at the start of the global heap's next block: `MMSYSTEM`'s code segment 1, 480h bytes, loaded at start-up into the space KERNEL gave back. Its bytes there are MMSYSTEM's first routine.
- [[read out]] That routine is `timeGetSystemTime` ([[topic:multimedia-timer]]) (`MMSYSTEM.DLL` seg1 `0000`-`0026`, ordinal 601). For a size under 8 it answers `TIMERR_STRUCT`, 81h, and writes nothing; it pops six bytes. The last word pushed is the size and the two before it the pointer, so seven noughts give 81h.
- [[documented]] On a 386 a far call to an offset past the code segment's limit is a general protection fault, raised by the call itself. [[read out]] KERNEL's handler for it (seg1 `5fa2`, through `5e1b`) would offer the program's `__GP` table, TOOLHELP and a debugger the fault, then show "Application Error" with `SysErrorBox` (seg1 `5c80`) and end the program (seg1 `5e01`). DOSBox 0.74 checks no offset against a code segment's limit (`cpu.cpp`, `CPU_CALL`), so under the oracle the call runs on into MMSYSTEM's code instead.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

Both engines answer it as the oracle runs it: `timeGetSystemTime` of the pointer and size the call's last three words give, six bytes popped (`kernel/internals.ts`, `kernel_calls/internals.rs`). The fault a real 386 would raise is not modelled: WinBox's oracle is DOSBox, and the block past KERNEL's code is the same in every session that loads `MMSYSTEM` at start-up. [[probe:emscopy]]'s `call` agrees. Its `entry`, and [[probe:emspast]]'s `entry`, `block` and `bytes`, are known gaps: WinBox's `EMSCopy` is an export within its stubs' segment, and its `MMSYSTEM` is its own. See [[topic:kernel-internals]].

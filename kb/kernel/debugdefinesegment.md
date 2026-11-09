---
kind: function
module: KERNEL
name: DebugDefineSegment
ordinal: 314
summary: Tells a debugger where a segment of a module was loaded. The export points at a near routine, so only KERNEL itself can call it; WinBox answers a call with nothing done.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9835`-`9867` (`KRNL286.EXE` seg1 `8fe7`). Unless bits 3 or 4 of 328h are set (a system debugger, or a hook from [[fn:KERNEL.RegisterPtrace]] or [[fn:KERNEL.ToolHelpHook]]), it does nothing. Otherwise it loads its arguments into registers: ES:DI a far pointer, and BX, CX, DX and SI four words. [[inferred]] These are what `INT 41h`'s segment-defined call takes: the module's name, and the segment's number, selector and kind. It then calls KERNEL's event routine (seg1 `9a50`) with AX 50h, the code for a segment defined. That routine makes `INT 41h` for a system debugger and calls the hooks ([[fn:KERNEL.ToolHelpHook]]).
- [[read out]] It is a near procedure. Its arguments are read from BP+4 up, where a near call leaves them, and it returns with a near `RET 0Ch`, twelve bytes popped (`984b`-`9867`). A far call through the export would take the far return's segment as its first argument and return to the wrong place.
- [[read out]] KERNEL calls it near, from its segment loader for each segment it loads (seg1 `78ed`), and while it starts, for its own segments (seg1 `aa44`, `aa53`).
- Not measured: a far call returns into KERNEL's own code at the caller's offset.

## Callers

- KERNEL only. No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

**Not applicable (c).** Only KERNEL's segment loader reaches it, near. Both engines answer a call as its no-debugger path does -- nothing -- popping the twelve bytes its `RET 0Ch` pops (`nothing` in `src/win16/kernel/retail.ts`); what a far call does in Windows has no answer to follow. See [[topic:kernel-internals]].

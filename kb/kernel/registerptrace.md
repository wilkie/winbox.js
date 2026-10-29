---
kind: function
module: KERNEL
name: RegisterPtrace
ordinal: 202
summary: Sets the procedure KERNEL tells of its events when no ToolHelpHook procedure claims them — the older hook a debugger such as CodeView for Windows, or TOOLHELP under Windows 3.0, uses.
topics: [kernel-internals, tool-helper]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `081d`-`0849` (the same offset in `KRNL286.EXE`). Its argument is a far procedure, four bytes popped.
  1. It sets bit 4 of the byte at 328h and writes the procedure to 308h and 30Ah of KERNEL's data (`0823`-`0837`).
  2. If the procedure is nought and no [[fn:KERNEL.ToolHelpHook]] procedure is set (bit 7 of 328h), bit 4 is cleared again (`083a`-`0843`).
  3. Nothing is answered. Unlike `ToolHelpHook`, the old procedure is not given back.
- [[read out]] KERNEL calls the procedure from its event routine, seg1 `9a50`, for codes up to 65h, when no `ToolHelpHook` procedure took the event (`9aa4`-`9ad8`). It is also called from the routine at seg1 `7e77` that tells of event 59h (`7eba`-`7ef4`), and from [[fn:KERNEL.CVWBreak]] with AX 63h. Bit 4 also turns on [[fn:KERNEL.DebugDefineSegment]]'s telling (seg1 `983e`).
- Not yet measured.

## Callers

- [[read out]] `TOOLHELP.DLL` imports it by ordinal and uses it only where KERNEL has no `ToolHelpHook`, that is under Windows 3.0, and only when no module named `WINDEBUG` is loaded (TOOLHELP seg1 `1d1a`-`1d34`, `1d6c`-`1d78`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines.

**Recommendation: not needed.** Only a debugger would call it. A no-op that pops four bytes is all a program could observe without one, and it costs one line. A working hook would come with [[fn:KERNEL.ToolHelpHook]]'s. See [[topic:kernel-internals]].

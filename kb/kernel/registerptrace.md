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
  3. The old procedure is not given back, unlike `ToolHelpHook`; AX is left the new one's selector (below).
- [[read out]] KERNEL calls the procedure from its event routine, seg1 `9a50`, for codes up to 65h, when no `ToolHelpHook` procedure took the event (`9aa4`-`9ad8`). It is also called from the routine at seg1 `7e77` that tells of event 59h (`7eba`-`7ef4`), and from [[fn:KERNEL.CVWBreak]] with AX 63h. Bit 4 also turns on [[fn:KERNEL.DebugDefineSegment]]'s telling (seg1 `983e`).
- [[read out]] What it leaves in AX is the procedure's selector, the word it loads last (`0833`). DX is kept.
- [[measured]] [[probe:kintrnl]]: given the address of [[fn:KERNEL.ValidateFreeSpaces]] (a lone `RETF` in Windows), AX is that address's selector; given nought, AX is nought. DX is kept and four bytes are popped.

## Callers

- [[read out]] `TOOLHELP.DLL` imports it by ordinal and uses it only where KERNEL has no `ToolHelpHook`, that is under Windows 3.0, and only when no module named `WINDEBUG` is loaded (TOOLHELP seg1 `1d1a`-`1d34`, `1d6c`-`1d78`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

Both engines answer the procedure's selector in AX and keep DX (`crates/winbox-win16/src/kernel_calls/internals.rs`). No procedure is kept: WinBox tells no debugger of its events. The side effect a program could see in Windows is the procedure being called on KERNEL's events; that would come with [[fn:KERNEL.ToolHelpHook]]'s, which is not done. See [[topic:kernel-internals]].

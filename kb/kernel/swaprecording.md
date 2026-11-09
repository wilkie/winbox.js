---
kind: function
module: KERNEL
name: SwapRecording
ordinal: 204
summary: Checks its flag and records nothing, in the retail Windows 3.1, leaving the flag in AX and 167h in DX; a flag over 2 is a parameter error, only a warning.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `014e`-`0167` (the same offset in `KRNL286.EXE`). One word, popped. It pushes the offset of its own `RETF 2` as the place to return to on an error. A flag above 2 goes to KERNEL's parameter error with code E001h, through the stub at seg3 `01a2`, which hands it to [[fn:KERNEL.K327]]. Any flag then ends at seg3 `06f3`, a bare `RETF 2`, the flag in AX and 167h in DX (below).
- [[documented]] The SDK's headers declare it, `void SwapRecording(UINT)` (Open Watcom's `win16.h`). The recording of segment swaps it starts and stops is the debugging build's.
- [[read out]] What it leaves is not AX and DX as they were. AX is the flag, loaded at `0154`. DX is 167h, the offset it pushed, popped at `0162` on every path. A flag above 2 is a warning to [[fn:KERNEL.K327]] (code E001h, bit 15 of BX set), which in the retail build tells [[fn:KERNEL.LogParamError]] and comes back with AX kept (seg1 `949b`-`94c4`).
- [[measured]] [[probe:kintrnl]]: flags 0, 2, 3 and 1234h each leave the flag in AX and 167h in DX, two bytes popped.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

WinBox answers DX:AX as 167h and the flag (`crates/winbox-win16/src/kernel_calls/internals.rs`), with 167h a named constant there. See [[topic:kernel-internals]].

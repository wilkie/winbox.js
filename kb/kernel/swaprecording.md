---
kind: function
module: KERNEL
name: SwapRecording
ordinal: 204
summary: Checks its flag and does nothing else, in the retail Windows 3.1; a flag over 2 is a parameter error.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `014e`-`0167` (the same offset in `KRNL286.EXE`). One word, popped. It pushes the offset of its own `RETF 2` as the place to return to on an error. A flag above 2 goes to KERNEL's parameter error with code E001h, through the stub at seg3 `01a2`, which hands it to [[fn:KERNEL.K327]]. Any flag then ends at seg3 `06f3`, a bare `RETF 2`. AX and DX are left as they were.
- [[documented]] The SDK's headers declare it, `void SwapRecording(UINT)` (Open Watcom's `win16.h`). The recording of segment swaps it starts and stops is the debugging build's.
- Not yet measured.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines, which pops the word.

**Recommendation: implement as a no-op.** What a program could see of the error path is a debugger message, and only under a debugger. A retail no-op that pops two bytes is enough: one line in each engine. See [[topic:kernel-internals]].

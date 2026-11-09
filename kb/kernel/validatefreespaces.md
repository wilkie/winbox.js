---
kind: function
module: KERNEL
name: ValidateFreeSpaces
ordinal: 200
summary: Nothing, in the retail Windows 3.1 — a bare return. The SDK declares it, for the debugging build's check of free memory.
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `3e4e`, a lone `RETF`; `KRNL286.EXE` seg1 `3848` the same. No arguments, nothing popped, AX and DX left as they were.
- [[documented]] The SDK's headers declare it, `void ValidateFreeSpaces(void)` (Open Watcom's `win16.h`, the census's source for what is documented). The checking it describes is the debugging build's, which this installation does not have.
- [[measured]] [[probe:kintrnl]]: AX and DX kept, nothing popped.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

A retail no-op (`nothing`), beside [[fn:KERNEL.K329]]. See [[topic:kernel-internals]].

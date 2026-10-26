---
kind: function
module: KERNEL
name: GlobalFreeAll
ordinal: 26
summary: Every block of the global heap an owner has freed: a task's prefix, nought for the running task's.
versions:
  '3.1': exact
probes: [gfreeal]
records: [child]
source: src/win16/kernel/more-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `0e39`-`0e87`: the owner given, or for nought the running task's prefix (`0c62`); each arena it owns told to a debugger (`9871`), then freed (`458d`).
- [[measured]] [[probe:gfreeal]]: a program's own moveable and fixed blocks are freed, a block it made with `GMEM_SHARE` -- its module's -- is left; the answer FFFFh; the program goes on and ends.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `kernel_calls/more.rs`.

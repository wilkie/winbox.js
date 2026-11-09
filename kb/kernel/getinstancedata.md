---
kind: function
module: KERNEL
name: GetInstanceData
ordinal: 54
summary: Copies bytes from another instance's data segment to the same offset of the caller's, as a program's second instance takes what its first set up.
versions:
  '3.1': exact
records: [instance]
probes: [locinfo]
source: crates/winbox-win16/src/memory.rs
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] [[probe:locinfo]] starts a second instance of itself, which asks for 16 bytes of the first's data where the first wrote `first instance`: it answers 16, and the bytes are the first's. For no bytes it answers nought.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg2 `0219` checks the handle (seg2 `02bb`) and goes on to seg2 `08a9`, which finds the instance's segment with `GlobalHandle`'s helper (seg1 `0ece`), copies the bytes from it at the offset to the caller's DS at the same offset, and answers the count; nought where the handle has no segment.

## Implementation

WinBox finds a program's or a library's data segment from its instance and copy the bytes.

Not yet done:

- A module WinBox keeps has no data segment here, and answers nought.

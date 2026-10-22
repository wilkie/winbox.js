---
kind: function
module: KERNEL
name: LocalCountFree
ordinal: 161
summary: The bytes free in the caller's local heap, each free block less its arena's ten; undocumented.
versions:
  '3.1': exact
records: [heap]
probes: [locinfo]
source: src/win16/kernel/LocalNotify.ts
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] [[probe:locinfo]] asks it of its own heap, found by ordinal: 3AEh as it starts, 4D6h with a fixed block of 100 bytes and a moveable one of 300h, which grew the heap, and 83Ch with both freed.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg2 `29c9`-`2a00`: the heap's information at DS:6 must be readable at 28h within DS's limit (seg1 `2a55`) and hold `LH` there, else nought. From the first arena's next free arena to the last arena, it adds each free arena's size less 0Ah.

## Implementation

Both engines walk the free list in the segment, as KERNEL does.

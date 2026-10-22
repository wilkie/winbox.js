---
kind: function
module: KERNEL
name: LocalHeapSize
ordinal: 162
summary: The caller's local heap's size, from its first arena to its last; undocumented.
versions:
  '3.1': exact
records: [heap]
probes: [locinfo]
source: src/win16/kernel/LocalNotify.ts
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] [[probe:locinfo]] asks it of its own heap, found by ordinal: 3F4h as it starts, and 914h once a moveable block of 300h has grown it, which it stays at when the blocks are freed.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg2 `2a01`-`2a0b`: the last arena's address less the first's, from the heap's information at DS:6, with nothing checked.

## Implementation

Both engines read the same two words.

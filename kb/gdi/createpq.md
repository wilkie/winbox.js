---
kind: function
module: GDI
name: CreatePQ
ordinal: 230
summary: Makes a priority queue of room for a number of entries: a global block with four header words; answers its handle.
versions:
  '3.1': exact
probes: [gdipq]
topics: [gdi-priority-queue]
---

## Observed behaviour

- [[measured]] A queue of four answers a handle whose block reads `[0 16 0 0]`: no entries, room for 16 bytes of them ([[probe:gdipq]]).

## Inside Windows

[[read out]] `GDI.EXE` seg27 `0000`: `GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, count * 4 + 8)` (seg1 `1f6d`); the header written `[0, count * 4, 0, 0]` through `GlobalLock` and the block unlocked; the handle answered, or -1 where no block was given.

## Implementation

As read out, on the block itself, so a program reading it sees Windows' words. [[probe:gdipq]] agrees in both.

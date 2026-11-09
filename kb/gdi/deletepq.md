---
kind: function
module: GDI
name: DeletePQ
ordinal: 235
summary: Frees a priority queue's block; answers GlobalFree's answer.
versions:
  '3.1': exact
probes: [gdipq]
topics: [gdi-priority-queue]
---

## Observed behaviour

- [[measured]] Nought for a queue ([[probe:gdipq]]).

## Inside Windows

[[read out]] `GDI.EXE` seg27 `01cb`: `GlobalFree(handle)`, its answer.

## Implementation

As read out, on the block itself, so a program reading it sees Windows' words. [[probe:gdipq]] agrees in both.

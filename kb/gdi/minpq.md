---
kind: function
module: GDI
name: MinPQ
ordinal: 231
summary: Answers the tag of a priority queue's first entry without taking it; -1 for an empty queue.
versions:
  '3.1': exact
probes: [gdipq]
topics: [gdi-priority-queue]
---

## Observed behaviour

- [[measured]] An empty queue answers -1; one in order or a heap, its first entry's tag ([[probe:gdipq]]).

## Inside Windows

[[read out]] `GDI.EXE` seg27 `00fb`: the same body as [[fn:GDI.ExtractPQ]] with CL nought -- its `mov cl,1` hidden in a `cmp ax` -- answering the tag of the entry where word 3 points, -1 where word 3 is at or past word 0.

## Implementation

In both engines as read out, on the block itself, so a program reading it sees Windows' words. [[probe:gdipq]] agrees in both.

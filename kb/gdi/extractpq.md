---
kind: function
module: GDI
name: ExtractPQ
ordinal: 232
summary: Takes a priority queue's first entry and answers its tag; -1 for an empty queue.
versions:
  '3.1': exact
probes: [gdipq]
topics: [gdi-priority-queue]
---

## Observed behaviour

- [[measured]] In order, word 3 moves on four bytes and the entries stay ([[probe:gdipq]]).
- [[measured]] In a heap, the last entry is put first and sifted down: `7:102 7:101 9:103` after 2:104 is taken from `2:104 7:101 9:103 7:102` -- the right child taken where the keys tie.
- [[measured]] The last entry taken empties the header but its room: `[0 16 0 0]`, and the queue is in order again.

## Inside Windows

[[read out]] `GDI.EXE` seg27 `00fe`: the first entry's tag; with it the last, words 0, 2 and 3 nought; in order (word 2 below 4000h, unsigned), word 3 moved on; a heap's last entry -- at word 3 plus word 0 less four -- moved first and word 0 made that, then from the first down: the smaller child, the right where they tie (`01b7`), swapped where it is the smaller (`00d9`), all the way to the end without stopping.

## Implementation

As read out, on the block itself, so a program reading it sees Windows' words. [[probe:gdipq]] agrees in both.

---
kind: function
module: GDI
name: InsertPQ
ordinal: 233
summary: Adds a key and its tag to a priority queue: appended while keys come in order, sifted into a heap once one does not; answers the queue, or -1 where it is full.
versions:
  '3.1': exact
probes: [gdipq]
topics: [gdi-priority-queue]
---

## Observed behaviour

- [[measured]] Keys 5, 7, 7 are appended in order, word 2 the last key ([[probe:gdipq]]).
- [[measured]] Key 2 after 9, with the first entry taken, moves the entries down, makes them a heap -- word 2 4000h -- and sifts 2 to the front: `2:104 7:101 9:103 7:102`.
- [[measured]] Into a queue whose entries fill it, -1 and nothing changed.
- [[measured]] Key -5 into a heap is appended at the end and made the last key, unsifted: keys are compared unsigned, and FFFBh is not below 4000h.

## Inside Windows

[[read out]] `GDI.EXE` seg27 `0045`: -1 where the block does not lock or its entries from word 3 on fill it. An entry that would end the block moves the entries down first (`025a`). The key and tag appended and word 0 moved on; a key not below word 2, unsigned, becomes word 2. A smaller one moves the entries down, sets word 2 to 4000h and is swapped with its parent -- the entry at `((offset >> 1) - 2) & ~3` -- while its key is the smaller (`00d9`). The queue's handle answered.

## Implementation

As read out, on the block itself, so a program reading it sees Windows' words. [[probe:gdipq]] agrees in both.

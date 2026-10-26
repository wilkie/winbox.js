---
kind: function
module: GDI
name: SizePQ
ordinal: 234
summary: Asks, grows or shrinks a priority queue's room; answers GlobalUnlock's answer, nought, or -1 where the block is not given.
versions:
  '3.1': exact
probes: [gdipq]
topics: [gdi-priority-queue]
---

## Observed behaviour

- [[measured]] Asked (nought), grown by two, and shrunk below what its entries reach, each answers nought; grown, word 1 is 24 ([[probe:gdipq]]). Shrunk too far, nothing changes.

## Inside Windows

[[read out]] `GDI.EXE` seg27 `01dc`: asked, the room in entries is put in AX and `GlobalUnlock`'s answer then overwrites it; the new room below word 0, -1 in AX, overwritten the same. Otherwise the block unlocked, `GlobalReAlloc(handle, room + 8, GMEM_MOVEABLE)` -- -1 where it fails -- the new block locked, word 1 written and unlocked: `GlobalUnlock`'s answer, nought for its moveable block. -1 where the block does not lock.

## Implementation

In both engines as read out, on the block itself, so a program reading it sees Windows' words. [[probe:gdipq]] agrees in both.

---
kind: function
module: KERNEL
name: GlobalFlags
ordinal: 22
summary: Reports a global block's lock count in its low byte and its flags in its high byte.
versions:
  '3.1': exact
probes: [memory, handles]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] A new 64-byte block reports `0x0000` when it is moveable and when it is fixed, and `0x0100` when it is moveable and discardable — 3 records of [[probe:memory]]. Being moveable is not among the flags it reports.
- [[measured]] After two `GlobalLock` calls on the same block, the low byte is still 0, for moveable and fixed blocks — 2 records of [[probe:handles]].

## Nuances

- [[documented]] The high byte carries bits such as discardable and discarded, and the low byte is the lock count.
- [[inferred]] So on these recordings a program cannot use the lock count to tell whether a block is locked.
- Not yet measured: the lock count of a discardable block, `GMEM_DISCARDED` after a discard, and flags such as `GMEM_DDESHARE`.

## Implementation

`GlobalFlags` returns the flags the block was allocated with, masked to `0x0100`, and a lock count of 0. See [[topic:global-and-local-memory]].

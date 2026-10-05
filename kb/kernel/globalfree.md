---
kind: function
module: KERNEL
name: GlobalFree
ordinal: 17
summary: Releases a global block and its handle, returning NULL when it succeeds.
versions:
  '3.1': exact
probes: [memory, glocks]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] Freeing an unlocked 256-byte moveable block returns `NULL` — the one record of [[probe:memory]] that checks it.
- [[measured]] A locked block is freed all the same, and `NULL` is answered: moveable blocks locked once, twice or three times and unlocked fewer times, fixed blocks locked once or twice, and discardable blocks still counting a lock. Afterwards the handle has a size of 0 and flags of 0, [[fn:KERNEL.GlobalHandle]] of the old selector answers 0, and the old pointer is not readable — 10 blocks of [[probe:glocks]].

## Nuances

- [[documented]] Failure returns the handle that was passed in, not `NULL`.
- Not yet measured: freeing twice, what a handle reads as once it has been freed, and whether its selector is reused by the next allocation. The probe records only the return value.
- [[inferred]] Every probe of the two heaps frees its blocks, and [[probe:handles]] frees them after measuring, but no record checks the result of those calls.

## Implementation

The allocator's `free` reports success without releasing anything: the selectors stay marked as used and the block's bookkeeping is kept. So the recorded return value agrees, but memory given back is never reused, and nothing measures that yet.

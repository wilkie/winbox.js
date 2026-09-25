---
kind: function
module: KERNEL
name: GlobalReAlloc
ordinal: 16
summary: Resizes a global block, and on the recorded cases hands back the same handle with the block still at the same address.
versions:
  '3.1': exact
probes: [handles]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] Growing a moveable block from 256 to 1024 bytes, shrinking one from 1024 to 256, growing a fixed block from 256 to 1024, and resizing a moveable block from 256 to 256 all return the handle they were given, and [[fn:KERNEL.GlobalLock]] gives the same address afterwards as before — 4 of 4 records of [[probe:handles]].
- [[measured]] [[fn:KERNEL.GlobalSize]] reports the new size afterwards: 1024, 256, 1024 and 256.
- [[measured]] A fixed block grows in place just as a moveable one does.

## Nuances

- [[inferred]] In protected mode nothing has to move for these sizes: the descriptor's limit can change while its base stays put, which is consistent with what was recorded.
- Not yet measured: a resize that crosses 64 KiB, a resize to zero bytes, `GMEM_MODIFY` and the other flags, a locked moveable block, and whether a grown block's new bytes are zeroed.

## Implementation

The allocator rounds the new size to 32 bytes as [[fn:KERNEL.GlobalAlloc]] does and keeps the block where it is. Every block already has a whole 64 KiB selector behind it, so a size that still fits in the selectors it was given changes only the bookkeeping. One that would need more selectors is refused with `NULL` rather than guessing at a relocation nothing has measured. The flags argument is ignored.

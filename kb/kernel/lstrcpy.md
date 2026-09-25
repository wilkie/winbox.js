---
kind: function
module: KERNEL
name: lstrcpy
ordinal: 88
summary: Copies a null-terminated string, terminator included, into a buffer the caller supplies.
versions:
  '3.1': exact
probes: [strings]
source: src/win16/kernel/lstrcpy.ts
---

## Observed behaviour

- [[documented]] The destination must have room for the whole string and its terminator; nothing checks that it does. The return value is the destination pointer.
- [[measured]] 3 of 3 recorded copies agree: `""`, `"hello"` and `"a"` each come back unchanged. See [[probe:strings]].

## Nuances

- [[measured]] The probe records what lands in the buffer, not the pointer returned, so the return value is not among the recorded cases.
- Not yet measured: overlapping source and destination, a NULL pointer, and a double-byte character set.

## Implementation

Copies byte by byte up to and including the first zero, giving up after 64K, and returns the destination. See [[fn:KERNEL.lstrcat]] and [[fn:KERNEL.lstrlen]].

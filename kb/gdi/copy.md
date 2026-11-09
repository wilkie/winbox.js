---
kind: function
module: GDI
name: Copy
ordinal: 250
summary: Copies bytes from one far pointer to another for the spooler, forward a byte at a time; answers nothing.
versions:
  '3.1': exact
probes: [gdicopy]
records: [copy]
topics: [printing]
---

## Observed behaviour

- [[measured]] Five bytes copied to a buffer apart from them arrive as they were; none copied leaves the buffer as it was ([[probe:gdicopy]]).
- [[measured]] Eight bytes of "xyz" copied onto the byte after their start leave nine x's: the copy goes forward a byte at a time and reads what it has just written.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `0000`: `Copy(lpDestination, lpSource, count)` is `rep movsb` from the source to the destination, CX the count, and `retf 0Ah`; AX is left as it was.

## Implementation

As read out. [[probe:gdicopy]] agrees in both.

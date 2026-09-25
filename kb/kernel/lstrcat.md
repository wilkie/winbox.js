---
kind: function
module: KERNEL
name: lstrcat
ordinal: 89
summary: Appends one null-terminated string to the end of another, in the first string's buffer.
versions:
  '3.1': exact
probes: [strings]
source: src/win16/kernel/lstrcat.ts
---

## Observed behaviour

- [[documented]] The second string is written over the first one's terminator, and the first buffer must have room for both. The return value is the first pointer.
- [[measured]] 3 of 3 recorded appends agree: `"hello"` and `" world"` give `"hello world"`, `"a"` and `"b"` give `"ab"`, and two empty strings give an empty string. See [[probe:strings]].

## Nuances

- [[measured]] Each append is made to a buffer the probe has just filled with [[fn:KERNEL.lstrcpy]], and what is recorded is the buffer afterwards, not the pointer returned.
- Not yet measured: overlapping strings, a NULL pointer, and a double-byte character set.

## Implementation

Finds the first string's terminator, then copies the second string over it byte by byte, terminator included, each walk giving up after 64K.

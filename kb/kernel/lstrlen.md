---
kind: function
module: KERNEL
name: lstrlen
ordinal: 90
summary: Counts the bytes of a null-terminated string, leaving the terminator out of the count.
versions:
  '3.1': exact
probes: [strings]
source: src/win16/kernel/lstrlen.ts
---

## Observed behaviour

- [[documented]] The count is in bytes and stops at the first zero byte, which is not counted.
- [[measured]] 5 of 5 recorded lengths agree: `""` is 0, `"a"` is 1, `"hello"` is 5, `"with spaces and 1234"` is 20. See [[probe:strings]].
- [[measured]] A tab is an ordinary byte: `"tab\there"` is 8.

## Nuances

- [[measured]] The tab case once appeared to disagree. The probe's records were tab-separated, so that record split in the wrong place; the probes now escape tabs, newlines and backslashes. Nothing about `lstrlen` itself was wrong (`oracle/README.md`).
- Not yet measured: a NULL pointer, a string that runs to the end of its segment, and a double-byte character set.

## Implementation

Walks the bytes from the pointer to the first zero, giving up after 64K. See [[fn:KERNEL.lstrcpy]] and [[fn:KERNEL.lstrcat]].

---
kind: function
module: KERNEL
name: Reserved2
ordinal: 78
summary: USER's AnsiPrev, which KERNEL hands it to.
versions:
  '3.1': exact
probes: [ktask]
records: [string]
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `83ca`: CL is set to which of four functions this is, and KERNEL jumps to the procedure USER registered at its code's 38h. With none registered it would return.
- [[measured]] [[probe:ktask]]: the character before: two on from the start, for the probe's third character, as [[fn:USER.AnsiPrev]] answers.

## Implementation

The table entry is USER's own function in both engines.

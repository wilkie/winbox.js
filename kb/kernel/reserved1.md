---
kind: function
module: KERNEL
name: Reserved1
ordinal: 77
summary: USER's AnsiNext, which KERNEL hands it to.
versions:
  '3.1': exact
probes: [ktask]
records: [string]
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `83cd`: CL is set to which of four functions this is, and KERNEL jumps to the procedure USER registered at its code's 38h. With none registered it would return.
- [[measured]] [[probe:ktask]]: the next character: one on, for the probe's string, as [[fn:USER.AnsiNext]] answers.

## Implementation

The table entry is USER's own function in both engines.

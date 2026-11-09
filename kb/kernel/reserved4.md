---
kind: function
module: KERNEL
name: Reserved4
ordinal: 80
summary: USER's AnsiLower, which KERNEL hands it to.
versions:
  '3.1': exact
probes: [ktask]
records: [string]
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `83c7`: CL is set to which of four functions this is, and KERNEL jumps to the procedure USER registered at its code's 38h. With none registered it would return.
- [[measured]] [[probe:ktask]]: the string made small: `ABCÀÉ×Z` is `abcàé×z`, as [[fn:USER.AnsiLower]] answers.

## Implementation

The table entry is USER's own function.

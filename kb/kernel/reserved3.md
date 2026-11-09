---
kind: function
module: KERNEL
name: Reserved3
ordinal: 79
summary: USER's AnsiUpper, which KERNEL hands it to.
versions:
  '3.1': exact
probes: [ktask]
records: [string]
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `83c4`: CL is set to which of four functions this is, and KERNEL jumps to the procedure USER registered at its code's 38h. With none registered it would return.
- [[measured]] [[probe:ktask]]: the string made capitals: `abcÀé×z` is `ABCÀÉ×Z`, as [[fn:USER.AnsiUpper]] answers.

## Implementation

The table entry is USER's own function.

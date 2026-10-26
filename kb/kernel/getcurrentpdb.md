---
kind: function
module: KERNEL
name: GetCurrentPDB
ordinal: 37
summary: The running task's program segment prefix; in DX, KERNEL's own.
versions:
  '3.1': partial
probes: [ktask]
records: [task, kernelpsp]
source: src/win16/kernel/task-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `024e`-`025e`: AX the word at 60h of the running task's database, its prefix, and DX the word at 220h of KERNEL's data.
- [[measured]] [[probe:ktask]]: AX is the prefix TOOLHELP gives for the task. DX is a prefix too, starting `CD 20`, but not the task's: the one DOS made as it started KERNEL.

## Implementation

winbox.js's KERNEL was started by no DOS, has no prefix of its own, and leaves DX alone (a known gap).

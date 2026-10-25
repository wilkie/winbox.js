---
kind: function
module: KERNEL
name: __GP
ordinal: 342
summary: KERNEL's own table of the parts of its code that handle a general protection fault. It is data, not a function, and winbox.js leaves it.
---

## Observed behaviour

- [[read out]] The entry is in KERNEL's code segment, `KRNL386.EXE` seg1 `a820`. What is there is a table of words, not code. `HasGPHandler` reads it to find whether a fault happened in a part of KERNEL that handles faults itself. Any module can export a `__GP` of its own the same way.
- Not yet measured.

## Implementation

Named in KERNEL's table and left. winbox.js has no KERNEL code for such a table to describe, and no program imports KERNEL's. See [[topic:exported-constants]].

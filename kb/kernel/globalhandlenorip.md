---
kind: function
module: KERNEL
name: GlobalHandleNoRIP
ordinal: 159
summary: GlobalHandle without the debugging version's complaint about a bad selector.
versions:
  '3.1': exact
probes: [ktask]
records: [memory]
source: crates/winbox-win16/src/kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `0ec5`: the same lookup [[fn:KERNEL.GlobalHandle]] makes (`0e8a`, `0f8c`).
- [[measured]] [[probe:ktask]]: the same answer as `GlobalHandle` for the probe's data segment.

## Implementation

`kernel.rs (GlobalHandle)`.

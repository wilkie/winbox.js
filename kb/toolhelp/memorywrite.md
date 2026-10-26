---
kind: function
module: TOOLHELP
name: MemoryWrite
ordinal: 79
summary: Bytes written through any selector or handle, even a code segment's: how many.
versions:
  '3.1': exact
probes: [thtask]
records: [memory]
source: src/win16/toolhelp/memory.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `2b6c`-`2d5e`, as `MemoryRead`, writing a code segment through a data alias (`2d68`).
- [[measured]] [[probe:thtask]]: 50 bytes into a block of 100 at 60, and two into the probe's own code.

## Implementation

`src/win16/toolhelp/memory.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

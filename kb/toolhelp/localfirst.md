---
kind: function
module: TOOLHELP
name: LocalFirst
ordinal: 57
summary: A local heap's first arena.
versions:
  '3.1': exact
probes: [thheap]
records: [lwalk]
source: crates/winbox-win16/src/toolhelp/local.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `095e`: the heap information's word 6.
- [[measured]] [[probe:thheap]]: the probe's heap from its first arena. USER's and GDI's heaps are a known gap (`lsystem`).

## Implementation

`src/win16/toolhelp/local.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

---
kind: function
module: TOOLHELP
name: MemoryRead
ordinal: 78
summary: Bytes read through any selector or handle into a buffer: how many.
versions:
  '3.1': exact
probes: [thtask]
records: [memory]
source: crates/winbox-win16/src/toolhelp/memory.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `29c4`-`2b69`. A selector that is not present must be code, and is loaded. An offset at or past the block's size reads nothing, and the bytes read run to the selector's limit.
- [[measured]] [[probe:thtask]]: a block of 100 bytes reads to 128, its limit, and nothing past. Its handle reads too, and so does the probe's code segment. Selector nought reads nothing.

## Implementation

`src/win16/toolhelp/memory.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

---
kind: function
module: TOOLHELP
name: GlobalFirst
ordinal: 51
summary: The global heap walk's first block.
versions:
  '3.1': exact
probes: [thheap]
records: [gwalk]
source: crates/winbox-win16/src/toolhelp/global.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0318`.
- [[measured]] [[probe:thheap]]: the walk begins and ends with a sentinel, and meets the probe's block and data segment. FALSE for a wrong size.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

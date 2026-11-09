---
kind: function
module: TOOLHELP
name: LocalInfo
ordinal: 56
summary: How many arenas a local heap has.
versions:
  '3.1': exact
probes: [thheap]
records: [linfo]
source: crates/winbox-win16/src/toolhelp/local.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `090e`, `06f6`: the heap information's word 4.
- [[measured]] [[probe:thheap]]: 7 for the probe's heap. FALSE for a wrong size.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

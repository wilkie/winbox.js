---
kind: function
module: TOOLHELP
name: GlobalInfo
ordinal: 53
summary: How many blocks the global heap's walk has.
versions:
  '3.1': exact
probes: [thheap]
records: [ginfo]
source: crates/winbox-win16/src/toolhelp/global.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `02a2`, from the global heap's head (`0590`): its arenas, free ones and ones in the list of the least recently used.
- [[measured]] [[probe:thheap]]: TRUE, some blocks. FALSE for a wrong size.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

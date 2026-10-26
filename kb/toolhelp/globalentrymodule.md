---
kind: function
module: TOOLHELP
name: GlobalEntryModule
ordinal: 55
summary: The global block of a module's segment, by its number.
versions:
  '3.1': exact
probes: [thheap]
records: [gmodule]
source: src/win16/toolhelp/global.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `04a9`-`0578`: the entry in the module's segment table, from 1. FALSE past its last or for nought.
- [[measured]] [[probe:thheap]]: segment 1 the code, 2 the data, FALSE for nought and 3.

## Implementation

`src/win16/toolhelp/global.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

---
kind: function
module: TOOLHELP
name: GlobalNext
ordinal: 52
summary: The block after the one in a GLOBALENTRY.
versions:
  '3.1': exact
probes: [thheap]
records: [gwalk]
source: crates/winbox-win16/src/toolhelp/global.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0399`, from `dwNext`, or `dwNextAlt` for the free and least recently used walks.
- [[measured]] [[probe:thheap]].

## Implementation

`src/win16/toolhelp/global.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

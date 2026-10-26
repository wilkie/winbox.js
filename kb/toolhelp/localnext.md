---
kind: function
module: TOOLHELP
name: LocalNext
ordinal: 58
summary: The arena after the one in a LOCALENTRY; FALSE at the last.
versions:
  '3.1': exact
probes: [thheap]
records: [lwalk]
source: src/win16/toolhelp/local.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `09e9`.
- [[measured]] [[probe:thheap]]: every block, fixed, moveable and free, then FALSE.

## Implementation

`src/win16/toolhelp/local.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

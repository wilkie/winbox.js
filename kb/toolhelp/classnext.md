---
kind: function
module: TOOLHELP
name: ClassNext
ordinal: 70
summary: The class after the one in a CLASSENTRY; FALSE after the last.
versions:
  '3.1': exact
probes: [thtask]
records: [class]
source: crates/winbox-win16/src/toolhelp/classes.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `2925`: the class `wNext` names.
- [[measured]] [[probe:thtask]]: the walk, as `ClassFirst` begins it.

## Implementation

`src/win16/toolhelp/classes.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

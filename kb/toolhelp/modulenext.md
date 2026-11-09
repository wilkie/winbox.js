---
kind: function
module: TOOLHELP
name: ModuleNext
ordinal: 60
summary: The module after the one in a MODULEENTRY; FALSE after the last.
versions:
  '3.1': exact
probes: [thtask]
records: [module]
source: crates/winbox-win16/src/toolhelp/modules.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0ad9`: the module `wNext` names, NE 6 of the one before.
- [[measured]] [[probe:thtask]]: the walk reaches the probe's own module.

## Implementation

`src/win16/toolhelp/modules.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

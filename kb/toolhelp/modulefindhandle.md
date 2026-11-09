---
kind: function
module: TOOLHELP
name: ModuleFindHandle
ordinal: 62
summary: A module's entry by its handle; nought for nought or no module.
versions:
  '3.1': exact
probes: [thtask]
records: [module]
source: crates/winbox-win16/src/toolhelp/modules.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0b8c`. The handle must be a selector with `NE` at its start (`0bd7`-`0c00`).
- [[measured]] [[probe:thtask]]: the probe's own module, its name, its file and a count of 1. Nought for nought.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

---
kind: function
module: TOOLHELP
name: ModuleFindName
ordinal: 61
summary: A module's entry and handle by its name, case counting.
versions:
  '3.1': exact
probes: [thtask]
records: [module]
source: crates/winbox-win16/src/toolhelp/modules.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0b15`-`0b87`: the chain walked from the first, each name compared with USER's `lstrcmp`.
- [[measured]] [[probe:thtask]]: `USER` is found, with `C:\WINDOWS\SYSTEM\USER.EXE`. `user` is not.

## Implementation

`src/win16/toolhelp/modules.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

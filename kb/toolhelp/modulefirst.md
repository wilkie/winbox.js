---
kind: function
module: TOOLHELP
name: ModuleFirst
ordinal: 59
summary: KERNEL's module, the first in the chain, filled into a MODULEENTRY.
versions:
  '3.1': exact
probes: [thtask]
records: [module]
source: src/win16/toolhelp/modules.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0a90`, from `ThHook`'s `hExeHead`, filled in as `0bd7`-`0ca7` fills any module's entry.
- [[measured]] [[probe:thtask]]: KERNEL, then on to the probe's own module. FALSE for a wrong size.

## Implementation

`src/win16/toolhelp/modules.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

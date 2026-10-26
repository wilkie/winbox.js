---
kind: function
module: TOOLHELP
name: StackTraceCSIPFirst
ordinal: 67
summary: A frame begun from the registers given.
versions:
  '3.1': exact
probes: [thtask]
records: [stack]
source: src/win16/toolhelp/stack.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0f67`-`0fc7`: SS, CS, IP and BP as given, the running task's handle, and the code's module and segment number.
- [[measured]] [[probe:thtask]]: the probe's code, segment 1, its module.

## Implementation

`src/win16/toolhelp/stack.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

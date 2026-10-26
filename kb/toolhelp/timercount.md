---
kind: function
module: TOOLHELP
name: TimerCount
ordinal: 80
summary: The milliseconds since Windows started, both counts alike.
versions:
  '3.1': exact
probes: [thtask]
records: [timer]
source: src/win16/toolhelp/misc.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `2dae`-`2eb8`; see the topic.
- [[measured]] [[probe:thtask]]: the two counts equal, from `GetTickCount` before up to a tick past it after. FALSE for a wrong size.

## Implementation

`src/win16/toolhelp/misc.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

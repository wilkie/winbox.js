---
kind: function
module: TOOLHELP
name: TaskFirst
ordinal: 63
summary: The first task in KERNEL's list, filled into a TASKENTRY.
versions:
  '3.1': exact
probes: [thtask]
records: [task, child]
source: crates/winbox-win16/src/toolhelp/tasks.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0caa`: the head of KERNEL's list, from `ThHook`, filled in as `0e69`-`0f19` fills any task's entry. A `dwSize` other than 28h is refused.
- [[measured]] [[probe:thtask]]: the probe alone, and the last, its fields as the topic gives them. With a program of the probe's own waiting, that program comes first.

## Implementation

`src/win16/toolhelp/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

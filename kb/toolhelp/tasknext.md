---
kind: function
module: TOOLHELP
name: TaskNext
ordinal: 64
summary: The task after the one in a TASKENTRY, from its hNext; FALSE after the last.
versions:
  '3.1': exact
probes: [thtask]
records: [task, child]
source: src/win16/toolhelp/tasks.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0ced`: refused where `hNext` is nought or the size is wrong, otherwise the task `hNext` names filled in.
- [[measured]] [[probe:thtask]]: the walk ends after the last task.

## Implementation

`src/win16/toolhelp/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

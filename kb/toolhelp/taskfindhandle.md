---
kind: function
module: TOOLHELP
name: TaskFindHandle
ordinal: 65
summary: A task's entry by its handle; FALSE for a handle that is no task.
versions:
  '3.1': exact
probes: [thtask]
records: [task]
source: src/win16/toolhelp/tasks.ts
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0d2e`. The task's database must be a selector of more than FCh bytes with `TD` at FAh (`0e69`-`0e95`).
- [[measured]] [[probe:thtask]]: the probe's own entry for its task, FALSE for 1234h and for a wrong size.

## Implementation

`src/win16/toolhelp/tasks.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

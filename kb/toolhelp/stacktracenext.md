---
kind: function
module: TOOLHELP
name: StackTraceNext
ordinal: 68
summary: The frame the one in a STACKTRACEENTRY returns to; FALSE at the stack's end.
versions:
  '3.1': exact
probes: [thtask]
records: [stack]
source: crates/winbox-win16/src/toolhelp/stack.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0fca`, `1138`-`11cb`: from the words at BP; see the topic.
- [[measured]] [[probe:thtask]]: one frame on, near, 4 above, then the end.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

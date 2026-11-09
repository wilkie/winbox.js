---
kind: function
module: TOOLHELP
name: StackTraceFirst
ordinal: 66
summary: The first frame of a task's stack, from where its switch left it.
source: crates/winbox-win16/src/toolhelp/stack.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0f1c`, `10ac`-`1135`: from the frame at the task's SS:SP, its BP less its lowest bit, IP and CS at 10h, 12h and 14h. FALSE where BP is nought or not between the stack's top and bottom.
- Not yet measured.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

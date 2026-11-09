---
kind: function
module: TOOLHELP
name: GlobalEntryHandle
ordinal: 54
summary: A global block's entry by its handle or a selector of it.
versions:
  '3.1': exact
probes: [thheap]
records: [gentry, gtask]
source: crates/winbox-win16/src/toolhelp/global.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `0417`, with the arena found from the selector (`0848`).
- [[measured]] [[probe:thheap]]: blocks, segments and the module, as the topic gives them. FALSE for 1234h. On Windows a task's handle is a block of its own, `GT_TASK`. winbox.js answers the same (`gtask`).

## Implementation

`src/win16/toolhelp/global.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].

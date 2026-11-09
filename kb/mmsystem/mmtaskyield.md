---
kind: function
module: MMSYSTEM
name: mmTaskYield
ordinal: 905
summary: Yields if the task has a message waiting.
versions:
  '3.1': exact
probes: [mmmisc]
records: [task]
source: crates/winbox-win16/src/mmsystem/tasks.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: it comes back.

## Inside Windows

- [[read out]] seg4 `598`: `PeekMessage` with `PM_NOREMOVE` into its frame; a message there, `Yield`.

## Implementation

Both engines, as read out: `src/win16/mmsystem/tasks.ts` and `crates/winbox-win16/src/mmsystem/tasks.rs`, each calling USER and KERNEL as MMSYSTEM calls them.

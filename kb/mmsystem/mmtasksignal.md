---
kind: function
module: MMSYSTEM
name: mmTaskSignal
ordinal: 903
summary: Posts a task WM_USER, to wake it from mmTaskBlock.
versions:
  '3.1': exact
probes: [mmmisc]
records: [task]
source: crates/winbox-win16/src/mmsystem/tasks.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: the probe's task is posted 400h, for no window, its wParam and lParam nought. A task that is none answers nought.

## Inside Windows

- [[read out]] seg1 `264`: `PostAppMessage`, jumped to with `WM_USER` and noughts laid out after the task.

## Implementation

Both engines, as read out: `src/win16/mmsystem/tasks.ts` and `crates/winbox-win16/src/mmsystem/tasks.rs`, each calling USER and KERNEL as MMSYSTEM calls them.

---
kind: function
module: MMSYSTEM
name: mmGetCurrentTask
ordinal: 904
summary: The task running: KERNEL's GetCurrentTask.
versions:
  '3.1': exact
probes: [mmmisc]
records: [task]
source: crates/winbox-win16/src/mmsystem/tasks.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: the probe's own task.

## Inside Windows

- [[read out]] seg4 `5b9`: a jump to `GetCurrentTask`.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/tasks.rs`, each calling USER and KERNEL as MMSYSTEM calls them.

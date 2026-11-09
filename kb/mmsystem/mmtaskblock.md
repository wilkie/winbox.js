---
kind: function
module: MMSYSTEM
name: mmTaskBlock
ordinal: 902
summary: Waits for a task message from 3A0h up, dispatching the messages for windows meanwhile.
versions:
  '3.1': exact
probes: [mmmisc]
records: [task]
source: crates/winbox-win16/src/mmsystem/tasks.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: with a task message of 300h, a window's, one of 3A0h and one of 401h waiting, it answers 3A0h; the window's message was dispatched, 300h dropped, and 401h is left. With 401h and 400h waiting, 401h taken first, it answers 400h.

## Inside Windows

- [[read out]] seg4 `5be`: `GetMessage` into its frame; a message for a window translated and dispatched; one for none below 3A0h dropped; else its number. The task it is given is not used, and `WM_QUIT` is dropped as any other.

## Implementation

Both engines, as read out: `src/win16/mmsystem/tasks.ts` and `crates/winbox-win16/src/mmsystem/tasks.rs`, each calling USER and KERNEL as MMSYSTEM calls them.

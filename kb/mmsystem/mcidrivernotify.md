---
kind: function
module: MMSYSTEM
name: mciDriverNotify
ordinal: 711
summary: Posts a window MM_MCINOTIFY: how a driver says a command is done.
versions:
  '3.1': exact
probes: [mmmisc]
records: [notify]
source: src/win16/mmsystem/mci.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: the window is posted `MM_MCINOTIFY` (3B9h), the status its wParam and the device's ID its lParam; posting to a window that is none answers nought.

## Inside Windows

- [[read out]] seg1 `275`: USER's `PostMessage`, jumped to with the arguments laid out for it.

## Implementation

Both engines, as read out: `src/win16/mmsystem/mci.ts` and `crates/winbox-win16/src/mmsystem/mci.rs`.

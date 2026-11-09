---
kind: function
module: MMSYSTEM
name: mciGetCreatorTask
ordinal: 717
summary: The task that opened an MCI device.
versions:
  '3.1': exact
probes: [mmmisc]
records: [mci]
source: crates/winbox-win16/src/mmsystem/mci.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: a waveaudio device opened answers the probe's task; ID nought, an ID not open, and the device once closed answer nought.

## Inside Windows

- [[read out]] seg5 `15a5`: the task KERNEL's `GetCurrentTask` gave as the device's record was made (seg5 `1ae6`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/mci.ts` and `crates/winbox-win16/src/mmsystem/mci.rs`.

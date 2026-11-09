---
kind: function
module: MMSYSTEM
name: waveInGetNumDevs
ordinal: 501
summary: How many waveform input devices there are: the sum of the installed drivers' devices.
versions:
  '3.1': exact
probes: [mmdevs]
records: [count]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 with no sound driver.

## Inside Windows

- [[read out]] seg3 `f66`: the count MMSYSTEM keeps as it installs each `wave` driver a second time, as an input driver (`WIDM_GETNUMDEVS`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

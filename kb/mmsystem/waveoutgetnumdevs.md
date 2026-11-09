---
kind: function
module: MMSYSTEM
name: waveOutGetNumDevs
ordinal: 401
summary: How many waveform output devices there are: the sum of the installed drivers' devices.
versions:
  '3.1': exact
probes: [mmdevs]
records: [count]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 on the installation with no sound driver. With the Sound Blaster, 1 ([[probe:wavedev]]).

## Inside Windows

- [[read out]] MMSYSTEM installs each driver `[drivers]` names `wave` to `wave9` as it loads, asks each how many devices it has (`WODM_GETNUMDEVS`), and keeps the sum (seg2 `2bb`, `484`; seg3 `866`). The mapper's are not counted. [[topic:sound-devices]] has the rest.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

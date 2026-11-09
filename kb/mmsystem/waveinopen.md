---
kind: function
module: MMSYSTEM
name: waveInOpen
ordinal: 504
summary: Opens a waveform input device, or asks whether it takes a format.
versions:
  '3.1': exact
probes: [mmdevs]
records: [open]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: with no sound driver, 2, and a handle asked for written nought.

## Inside Windows

- [[read out]] seg3 `1033`: as [[fn:MMSYSTEM.waveOutOpen]], with `WIDM_OPEN` (34h).

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

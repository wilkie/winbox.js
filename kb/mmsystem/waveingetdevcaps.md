---
kind: function
module: MMSYSTEM
name: waveInGetDevCaps
ordinal: 502
summary: A waveform input device's capabilities, asked of its driver by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] With no device of the kind -- the installation with no sound driver -- device 0 and device 5 answer `MMSYSERR_BADDEVICEID` (2), and the mapper's number `MMSYSERR_NODRIVER` (6) ([[probe:mmnodev]]). With the Sound Blaster, device 0 is the driver's.

## Inside Windows

- [[read out]] seg3 `fa6`: as [[fn:MMSYSTEM.waveOutGetDevCaps]], with `WIDM_GETDEVCAPS` (33h).

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

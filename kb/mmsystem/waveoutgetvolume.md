---
kind: function
module: MMSYSTEM
name: waveOutGetVolume
ordinal: 415
summary: A waveform output device's volume, asked of its driver by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] With no device of the kind -- the installation with no sound driver -- device 0 and device 5 answer `MMSYSERR_BADDEVICEID` (2), and the mapper's number `MMSYSERR_NODRIVER` (6) ([[probe:mmnodev]]). With the Sound Blaster, device 0 is the driver's.
- [[measured]] The Sound Blaster's driver answers `MMSYSERR_NOTSUPPORTED` (8) ([[probe:mmnodev]]).

## Inside Windows

- [[read out]] seg3 `8f2`: the doubleword checked writable (11), then `WODM_GETVOLUME` (16) to the device by number.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

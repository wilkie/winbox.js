---
kind: function
module: MMSYSTEM
name: waveOutGetDevCaps
ordinal: 402
summary: A waveform output device's capabilities, asked of its driver by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: src/win16/mmsystem/wave.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: device 0 answers 2 with no sound driver.
- [[measured]] With no device of the kind -- the installation with no sound driver -- device 0 and device 5 answer `MMSYSERR_BADDEVICEID` (2), and the mapper's number `MMSYSERR_NODRIVER` (6) ([[probe:mmnodev]]). With the Sound Blaster, device 0 is the driver's.
- [[measured]] A size of nought answers nought, whatever the device ([[probe:mmnodev]]).

## Inside Windows

- [[read out]] seg3 `8a6`: nought for a size of nought; `MMSYSERR_INVALPARAM` (11) for a buffer that cannot be written for its size; else `WODM_GETDEVCAPS` (4) to the device by its number (seg3 `817`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

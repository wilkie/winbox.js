---
kind: function
module: MMSYSTEM
name: waveOutMessage
ordinal: 421
summary: Sends a waveform output device's driver any message: its answer, a doubleword.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.
- [[measured]] So it answers 0 for 1234h and nought ([[probe:mmnodev]]), where every other call on a handle answers 5.

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the message goes to the driver as it is, with its two parameters. A handle that is no device's answers nought, not an error.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

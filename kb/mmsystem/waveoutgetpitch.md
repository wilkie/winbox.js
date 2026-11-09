---
kind: function
module: MMSYSTEM
name: waveOutGetPitch
ordinal: 413
summary: Asks a waveform output device its pitch: a doubleword the driver writes.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.
- [[measured]] The Sound Blaster's driver answers `MMSYSERR_NOTSUPPORTED` (8) ([[probe:wavedev]]).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the doubleword is checked writable (`MMSYSERR_INVALPARAM`, 11), and `WODM_GETPITCH` (14) sent.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

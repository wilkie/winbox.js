---
kind: function
module: MMSYSTEM
name: waveOutGetID
ordinal: 420
summary: Gives the number a waveform output device was opened by.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.
- [[measured]] A refused handle leaves the word as it was ([[probe:mmnodev]]).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the word is checked writable (`MMSYSERR_INVALPARAM`, 11), and the number written: the mapper's for a device the mapper opened. No driver hears of it.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

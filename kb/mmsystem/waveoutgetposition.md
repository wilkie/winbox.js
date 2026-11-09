---
kind: function
module: MMSYSTEM
name: waveOutGetPosition
ordinal: 412
summary: Asks a waveform output device how far it has played, into an MMTIME.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the `MMTIME` is checked writable for the size given (`MMSYSERR_INVALPARAM`, 11), and `WODM_GETPOS` (13) sent.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

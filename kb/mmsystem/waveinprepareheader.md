---
kind: function
module: MMSYSTEM
name: waveInPrepareHeader
ordinal: 506
summary: Prepares a WAVEHDR for a waveform input device, MMSYSTEM doing it itself where the driver will not.
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

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform input device's (seg1 `1e8`), then the header checked as `waveOutPrepareHeader` checks it, all its flags cleared, and `WIDM_PREPARE` (36h) sent; `MMSYSERR_NOTSUPPORTED` has MMSYSTEM prepare it.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

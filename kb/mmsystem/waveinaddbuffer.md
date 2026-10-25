---
kind: function
module: MMSYSTEM
name: waveInAddBuffer
ordinal: 508
summary: Hands a prepared buffer to a waveform input device to record into.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: src/win16/mmsystem/wave.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform input device's (seg1 `1e8`), then the header checked; not prepared is 34, queued 33; `WIDM_ADDBUFFER` (38h) sent. Its done flag is left alone.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

---
kind: function
module: MMSYSTEM
name: waveOutUnprepareHeader
ordinal: 407
summary: Undoes waveOutPrepareHeader; a header still queued is refused.
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

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the header as `waveOutPrepareHeader` checks it. A header with `WHDR_INQUEUE` is `WAVERR_STILLPLAYING` (33); one not prepared answers nought. `WODM_UNPREPARE` (8) is sent, `MMSYSERR_NOTSUPPORTED` taken as done, and `WHDR_PREPARED` cleared.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

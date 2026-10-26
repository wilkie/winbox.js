---
kind: function
module: MMSYSTEM
name: waveOutWrite
ordinal: 408
summary: Hands a prepared buffer to a waveform output device to play.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: src/win16/mmsystem/wave.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.
- [[measured]] With the Sound Blaster, an unprepared header answers 34, and a second of silence played is done 1.1 seconds later ([[probe:wavedev]]).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the header as `waveOutPrepareHeader` checks it. Not prepared is `WAVERR_UNPREPARED` (34), still queued `WAVERR_STILLPLAYING` (33). `WHDR_DONE` is cleared and `WODM_WRITE` (9) sent; queuing and marking it done are the driver's.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

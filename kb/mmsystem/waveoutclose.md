---
kind: function
module: MMSYSTEM
name: waveOutClose
ordinal: 405
summary: Closes a waveform output device: the driver asked, and the handle let go only if it agrees.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.
- [[measured]] With the Sound Blaster, closing while a buffer still plays answers `WAVERR_STILLPLAYING` (33), the driver's ([[probe:wavedev]]).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then `WODM_CLOSE` (6) goes to the driver; the handle is freed only on its answer of nought (seg3 `b81`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

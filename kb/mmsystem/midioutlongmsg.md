---
kind: function
module: MMSYSTEM
name: midiOutLongMsg
ordinal: 209
summary: Sends a MIDI output device a system-exclusive message from a prepared header.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: src/win16/mmsystem/midi.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg6, seg1 `c4`-`1e4`: the handle is checked to be a MIDI output device's, then the header's flags only: a flag past the three it has is `MMSYSERR_INVALFLAG` (10); not prepared is `MIDIERR_UNPREPARED` (64), queued 65. `MODM_LONGDATA` (8) sent.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

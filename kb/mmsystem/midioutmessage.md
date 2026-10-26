---
kind: function
module: MMSYSTEM
name: midiOutMessage
ordinal: 216
summary: Sends a MIDI output device's driver any message: its answer, a doubleword.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: src/win16/mmsystem/midi.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5).
- [[measured]] So it answers 0 for 1234h and nought ([[probe:mmnodev]]).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg6, seg1 `c4`-`1e4`: the handle is checked to be a MIDI output device's, then the message passed on; a handle that is no device's answers nought.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

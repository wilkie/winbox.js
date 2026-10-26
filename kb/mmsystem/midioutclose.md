---
kind: function
module: MMSYSTEM
name: midiOutClose
ordinal: 205
summary: Closes a MIDI output device: the driver asked, and the handle let go only if it agrees.
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

- [[read out]] `MMSYSTEM.DLL` seg6, seg1 `c4`-`1e4`: the handle is checked to be a MIDI output device's, then `MODM_CLOSE` (4) goes to the driver, and the handle is freed on its answer of nought.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

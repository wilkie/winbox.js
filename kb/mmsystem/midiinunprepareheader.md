---
kind: function
module: MMSYSTEM
name: midiInUnprepareHeader
ordinal: 307
summary: Undoes midiInPrepareHeader; a header still queued is refused.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5).

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg6, seg1 `c4`-`1e4`: the handle is checked to be a MIDI input device's, then the header checked, and `MIDM_UNPREPARE` (3Ah) sent.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

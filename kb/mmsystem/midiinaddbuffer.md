---
kind: function
module: MMSYSTEM
name: midiInAddBuffer
ordinal: 308
summary: Hands a prepared buffer to a MIDI input device for system-exclusive messages.
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

- [[read out]] `MMSYSTEM.DLL` seg6, seg1 `c4`-`1e4`: the handle is checked to be a MIDI input device's, then the header checked as preparing checks it, then prepared (64) and not queued (65); `MIDM_ADDBUFFER` (3Bh) sent.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

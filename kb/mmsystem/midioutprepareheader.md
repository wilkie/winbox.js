---
kind: function
module: MMSYSTEM
name: midiOutPrepareHeader
ordinal: 206
summary: Prepares a MIDIHDR for a MIDI output device; the driver marks it prepared.
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

- [[read out]] `MMSYSTEM.DLL` seg6, seg1 `c4`-`1e4`: the handle is checked to be a MIDI output device's, then the header: writable for its size, its size 1Ch, no flag in its low word past the three a MIDI header has, its data writable (seg4 `353`). Already prepared answers nought. Its flags are cleared and `MODM_PREPARE` (5) sent; MMSYSTEM marks it prepared only where the driver answers `MMSYSERR_NOTSUPPORTED` (8) and it prepares the header itself.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

---
kind: function
module: MMSYSTEM
name: midiOutGetDevCaps
ordinal: 202
summary: A MIDI output device's capabilities, asked of its driver by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] With no device of the kind -- the installation with no sound driver -- device 0 and device 5 answer `MMSYSERR_BADDEVICEID` (2), and the mapper's number `MMSYSERR_NODRIVER` (6) ([[probe:mmnodev]]). With the Sound Blaster, device 0 is the driver's.
- [[measured]] With the Sound Blaster, the mapper's number is the MIDI Mapper's, and answers nought.

## Inside Windows

- [[read out]] seg6 `16a`: a size of nought answers nought, a buffer not writable 11, else `MODM_GETDEVCAPS` (2).

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

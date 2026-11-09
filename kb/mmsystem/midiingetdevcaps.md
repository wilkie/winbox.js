---
kind: function
module: MMSYSTEM
name: midiInGetDevCaps
ordinal: 302
summary: A MIDI input device's capabilities, asked of its driver by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] With no device of the kind -- the installation with no sound driver -- device 0 and device 5 answer `MMSYSERR_BADDEVICEID` (2), and the mapper's number `MMSYSERR_NODRIVER` (6) ([[probe:mmnodev]]). With the Sound Blaster, device 0 is the driver's.

## Inside Windows

- [[read out]] seg6 `625`: as [[fn:MMSYSTEM.midiOutGetDevCaps]], with `MIDM_GETDEVCAPS` (36h).

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

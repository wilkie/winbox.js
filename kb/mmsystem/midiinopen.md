---
kind: function
module: MMSYSTEM
name: midiInOpen
ordinal: 304
summary: Opens a MIDI input device.
versions:
  '3.1': exact
probes: [mmnodev]
records: [open]
source: src/win16/mmsystem/midi.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]]: device 5 answers 2; the mapper's number, with no mapper for input on either installation, `MMSYSERR_NODRIVER` (6).

## Inside Windows

- [[read out]] seg6 `6b2`: as [[fn:MMSYSTEM.midiOutOpen]], with `MIDM_OPEN` (37h).

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

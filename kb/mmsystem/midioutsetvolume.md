---
kind: function
module: MMSYSTEM
name: midiOutSetVolume
ordinal: 212
summary: Sets a MIDI output device's volume: its driver's message, by its number.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] Device numbers are refused as for [[fn:MMSYSTEM.midiOutGetVolume]].

## Inside Windows

- [[read out]] seg6 `1f7`: `MODM_SETVOLUME` (11) by number.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

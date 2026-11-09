---
kind: function
module: MMSYSTEM
name: midiOutGetVolume
ordinal: 211
summary: A MIDI output device's volume, asked of its driver by its number.
versions:
  '3.1': exact
probes: [mmnodev]
records: [id]
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]]: with no device, 2; the Sound Blaster's MIDI device answers 8.

## Nuances

- [[read out]] Asked of the MIDI Mapper while it is closed, `MIDIMAP.DRV` answers a doubleword of its frame it never set ([[topic:midi-mapper]]); the probe does not ask it.

## Inside Windows

- [[read out]] seg6 `1b6`: the doubleword checked writable (11), then `MODM_GETVOLUME` (10) by number.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

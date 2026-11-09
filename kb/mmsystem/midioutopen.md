---
kind: function
module: MMSYSTEM
name: midiOutOpen
ordinal: 204
summary: Opens a MIDI output device, or the MIDI Mapper.
versions:
  '3.1': exact
probes: [mmnodev]
records: [open]
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]]: any flag in the low word answers `MMSYSERR_INVALFLAG` (10); a callback window that is none, `MMSYSERR_INVALPARAM` (11); device 5, 2. The handle is left untouched by each.
- [[measured]] With the Sound Blaster its devices open as [[probe:mididev]] records.

## Inside Windows

- [[read out]] seg6 `2a7`: the handle writable, the callback, then the flags; the handle written nought. There is no asking only. Past the devices, 2; the mapper's number with no mapper, 6, no device tried in its place. The driver is sent `MODM_OPEN` (3) with a `MIDIOPENDESC`, and its own doubleword in the handle's block.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

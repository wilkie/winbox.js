---
kind: function
module: MMSYSTEM
name: midiInGetErrorText
ordinal: 303
summary: The text of a general or MIDI error: the same as midiOutGetErrorText.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] The same strings as [[fn:MMSYSTEM.midiOutGetErrorText]].

## Inside Windows

- [[read out]] seg6 `671`: the same code.

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

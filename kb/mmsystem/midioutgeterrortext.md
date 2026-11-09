---
kind: function
module: MMSYSTEM
name: midiOutGetErrorText
ordinal: 203
summary: The text of a general or MIDI error, from MMSYSTEM's own strings.
versions:
  '3.1': exact
probes: [mmnodev]
records: [text]
source: crates/winbox-win16/src/mmsystem/midi.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]]: 0 to 11 and 64 to 69 answer nought and their text; 32 and 35, waveform's, answer `MMSYSERR_BADERRNUM` (9).

## Inside Windows

- [[read out]] seg6 `266`, `21e`: as [[fn:MMSYSTEM.waveOutGetErrorText]], with MIDI's 64 to 69.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

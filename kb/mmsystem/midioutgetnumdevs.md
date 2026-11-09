---
kind: function
module: MMSYSTEM
name: midiOutGetNumDevs
ordinal: 201
summary: How many MIDI output devices there are: the sum of the installed drivers' devices.
versions:
  '3.1': exact
probes: [mmdevs]
records: [count]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 with no sound driver; with the Sound Blaster, 2 -- its own and the Ad Lib ([[probe:mididev]]).

## Inside Windows

- [[read out]] seg6 `15f`: the count MMSYSTEM keeps as it installs each `midi` driver (`MODM_GETNUMDEVS`), the mapper's left out.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

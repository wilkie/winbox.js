---
kind: function
module: MMSYSTEM
name: midiInGetNumDevs
ordinal: 301
summary: How many MIDI input devices there are: the sum of the installed drivers' devices.
versions:
  '3.1': exact
probes: [mmdevs]
records: [count]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 with no sound driver.

## Inside Windows

- [[read out]] seg6 `5e3`: the count MMSYSTEM keeps (`MIDM_GETNUMDEVS`).

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

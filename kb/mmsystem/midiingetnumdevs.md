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
source: src/win16/mmsystem/midi.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: 0 with no sound driver.

## Inside Windows

- [[read out]] seg6 `5e3`: the count MMSYSTEM keeps (`MIDM_GETNUMDEVS`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/midi.ts` and `crates/winbox-win16/src/mmsystem/midi.rs`, over the device layer of `devices.ts` and `devices.rs`.

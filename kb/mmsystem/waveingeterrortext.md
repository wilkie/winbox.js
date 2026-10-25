---
kind: function
module: MMSYSTEM
name: waveInGetErrorText
ordinal: 503
summary: The text of a general or waveform error: the same as waveOutGetErrorText.
versions:
  '3.1': exact
probes: [mmdevs]
records: [text]
source: src/win16/mmsystem/wave.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: the same texts as [[fn:MMSYSTEM.waveOutGetErrorText]].

## Inside Windows

- [[read out]] seg3 `ff2`: the same code as `waveOutGetErrorText`'s.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

---
kind: function
module: MMSYSTEM
name: waveOutGetErrorText
ordinal: 403
summary: The text of a general or waveform error, from MMSYSTEM's own strings.
versions:
  '3.1': exact
probes: [mmnodev]
records: [text]
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]]: 0 to 11 and 32 to 35 answer nought and their text; 12, 31, 36, 64, 69, 70 and 256 answer `MMSYSERR_BADERRNUM` (9), the buffer's first byte made nought.
- [[measured]] A buffer of one byte gets only the nought; one of five, four characters and the nought; a size of nought answers nought and leaves the buffer as it was.

## Inside Windows

- [[read out]] seg3 `95a`: a size of nought answers nought; a buffer not writable for its size, 11; then the first byte is made nought, a number outside the two ranges is 9, and the string is loaded where the size is two or more.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

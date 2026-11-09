---
kind: function
module: MMSYSTEM
name: waveOutSetVolume
ordinal: 416
summary: Sets a waveform output device's volume: its driver's message, by its number.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/mmsystem/wave.rs
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] Device numbers are refused as for [[fn:MMSYSTEM.waveOutGetVolume]]: 2 past the devices, 6 for the mapper with none installed.

## Inside Windows

- [[read out]] seg3 `933`: `WODM_SETVOLUME` (17) to the device by number, with the value.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `crates/winbox-win16/src/mmsystem/devices.rs`.

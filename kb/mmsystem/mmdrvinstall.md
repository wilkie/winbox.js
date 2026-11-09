---
kind: function
module: MMSYSTEM
name: mmDrvInstall
ordinal: 34
summary: Installs a driver's waveform, MIDI or auxiliary entry point, or removes one.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/mmsystem/mod.rs
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] MMSYSTEM uses it for each driver it installs as it loads; on the installation with the Sound Blaster, the counts it makes are [[probe:mmdevs]]'s.

## Inside Windows

- [[read out]] seg2 `484`: the entry point given, or found by its name in the driver's module; refused if none, or installed already; the first free of ten places, or the mapper's; `DRVM_INIT` sent and the devices counted. Removing refuses a driver with a device open. [[topic:sound-devices]] has the numbering.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/devices.rs`.

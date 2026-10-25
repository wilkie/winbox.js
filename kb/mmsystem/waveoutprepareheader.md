---
kind: function
module: MMSYSTEM
name: waveOutPrepareHeader
ordinal: 406
summary: Prepares a WAVEHDR for a waveform output device, MMSYSTEM doing it itself where the driver will not.
versions:
  '3.1': exact
probes: [mmnodev]
records: [handle]
source: src/win16/mmsystem/wave.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmnodev]], on the installation with no sound driver and on the one with the Sound Blaster: a handle that is no device's -- 1234h, or nought -- answers `MMSYSERR_INVALHANDLE` (5), before anything else is looked at.

## Inside Windows

- [[read out]] `MMSYSTEM.DLL` seg3: the handle is checked to be a waveform output device's (seg1 `1e8`), then the header: writable for its size, its size 20h, no flag in its low word but those a waveform header has, and its data writable for its length (seg4 `353`); else `MMSYSERR_INVALPARAM` (11). One already prepared answers nought. Its flags are cleared but `WHDR_BEGINLOOP` and `WHDR_ENDLOOP`, and `WODM_PREPARE` (7) sent; an answer of `MMSYSERR_NOTSUPPORTED` (8) has MMSYSTEM lock the header and its data itself and answer nought. Done, `WHDR_PREPARED` is set.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

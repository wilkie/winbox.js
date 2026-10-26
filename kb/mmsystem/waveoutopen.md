---
kind: function
module: MMSYSTEM
name: waveOutOpen
ordinal: 404
summary: Opens a waveform output device, or asks whether it takes a format.
versions:
  '3.1': exact
probes: [mmnodev]
records: [open]
source: src/win16/mmsystem/wave.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmdevs]]: with no sound driver every open, by number or through the mapper, answers 2, and a handle asked for is written nought.
- [[measured]] [[probe:mmnodev]]: a flag in the low word but `WAVE_FORMAT_QUERY` and `WAVE_ALLOWSYNC` answers `MMSYSERR_INVALFLAG` (10); a callback window that is none, a window's callback with a high word, a task that is none, a function in a program's code, and a callback kind past 3 answer `MMSYSERR_INVALPARAM` (11); each leaves the handle untouched. The program's own task as the callback is taken.
- [[measured]] With the Sound Blaster the device opens, and its callbacks come as [[probe:wavedev]] records.

## Inside Windows

- [[read out]] seg3 `9e3`: the format readable for 14 bytes and the callback (seg4 `477`) first, then the flags, then -- unless only asking -- the handle writable and written nought; with no device, 2. The mapper's number with no mapper tries each device in turn. Else a handle is made and `WODM_OPEN` (5) sent with a `WAVEOPENDESC` in MMSYSTEM's frame.
- [[read out]] A callback function must be in a code segment `GetCodeInfo` says is neither moveable nor discardable. KERNEL makes every segment of a program moveable as it reads the program's segment table (`KRNL386.EXE` seg2 `0f4b`-`0f6b`), so only a library's fixed code will do.

## Implementation

Both engines, as read out: `src/win16/mmsystem/wave.ts` and `crates/winbox-win16/src/mmsystem/wave.rs`, over the device layer of `devices.ts` and `devices.rs`.

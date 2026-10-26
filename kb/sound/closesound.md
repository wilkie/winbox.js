---
kind: function
module: SOUND
name: CloseSound
ordinal: 2
summary: The sound driver let go by the task that has it open.
versions:
  '3.1': exact
probes: [snddrv]
records: [open, threshold]
topics: [sound-devices]
source: src/win16/sound.ts
---

## Observed behaviour

- [[measured]] [[probe:snddrv]]: once closed, [[fn:SOUND.GetThresholdEvent]] answers an offset of nought and [[fn:SOUND.OpenSound]] 1.

## Inside Windows

- [[read out]] `SOUND.DRV` seg1 `04a7`-`04d2`: for the task that has it open, the sound stopped, `[90h]` cleared and the queue freed; for any other, nothing.

## Implementation

`src/win16/sound.ts`; the Rust engine's `crates/winbox-win16/src/sound.rs`.

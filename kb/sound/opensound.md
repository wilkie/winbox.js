---
kind: function
module: SOUND
name: OpenSound
ordinal: 1
summary: The sound driver for the task that asks, as long as no task has it: a voice, or -1.
versions:
  '3.1': exact
probes: [snddrv, sndplay]
records: [open, sound]
topics: [sound-devices]
source: crates/winbox-win16/src/sound.rs
---

## Observed behaviour

- [[measured]] [[probe:snddrv]]: 1, then -1 asked again without [[fn:SOUND.CloseSound]], then 1 again once closed. [[probe:sndplay]] records it opened and closed in turn.

## Inside Windows

- [[read out]] `SOUND.DRV` seg1 `03f0`-`0472`: -1, `S_SERDVNA`, where `[90h]` holds a task; else the current task kept there, its queue allocated (-2 where that fails), and 1.

## Implementation

`src/win16/sound.ts`; the Rust engine's `crates/winbox-win16/src/sound.rs`. The task kept at 90h of the driver's data; no queue.

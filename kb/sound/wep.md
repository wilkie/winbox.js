---
kind: function
module: SOUND
name: WEP
ordinal: 18
summary: The sound driver's exit procedure: 1.
versions:
  '3.1': exact
probes: [snddrv]
records: [wep]
topics: [sound-devices]
source: crates/winbox-win16/src/sound.rs
---

## Observed behaviour

- [[measured]] [[probe:snddrv]]: 1.

## Inside Windows

- [[read out]] `SOUND.DRV` seg1 `0004`: `MOV AX, 1`, popping the word.

## Implementation

`src/win16/sound.ts`; the Rust engine's `crates/winbox-win16/src/sound.rs`.

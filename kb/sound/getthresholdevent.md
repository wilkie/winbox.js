---
kind: function
module: SOUND
name: GetThresholdEvent
ordinal: 14
summary: A pointer to the sound driver's word of threshold flags, for the task that has the driver open.
versions:
  '3.1': exact
probes: [snddrv]
records: [threshold, status]
topics: [sound-devices]
source: crates/winbox-win16/src/sound.rs
---

## Observed behaviour

- [[measured]] [[probe:snddrv]]: with the driver open, offset 84h, and the word nought. Before it is opened and after it is closed, the offset is nought.

## Nuances

- [[read out]] For a task that does not have the driver open only AX is set, to nought: DX is what the caller left in it, so the pointer is not a null pointer unless DX was nought (`SOUND.DRV` seg1 `06e5`-`06fb`).
- [[read out]] [[fn:SOUND.GetThresholdStatus]] answers the same word and clears it (`06ff`-`0716`).

## Inside Windows

- [[read out]] `SOUND.DRV` seg1 `06e5`: the current task compared with the one that opened the driver (`[90h]`, `03e6`), then DS:84h.

## Implementation

`src/win16/sound.ts`; the Rust engine's `crates/winbox-win16/src/sound.rs`. The task that has the driver open is kept in its data at 90h, as [[fn:SOUND.OpenSound]] sets it; nothing sets a threshold, so the word stays nought.

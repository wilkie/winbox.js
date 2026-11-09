---
kind: function
module: SOUND
name: DoBeep
ordinal: 17
summary: The beep MessageBeep asks for: a system sound by the icon's kind through sndPlaySound, else the speaker.
versions:
  '3.1': exact
probes: [snddrv]
records: [beep]
topics: [sound-devices]
source: crates/winbox-win16/src/sound.rs
---

## Observed behaviour

- [[measured]] [[probe:snddrv]]: -1 and 30h return; what is left in AX is no answer.

## Inside Windows

- [[read out]] `SOUND.DRV` seg1 `000a`-`0052`. -1 sounds the speaker (`00be`). Any other kind names a sound by its second hexadecimal digit: nought `SystemDefault`, 1 `SystemHand`, 2 `SystemQuestion`, 3 `SystemExclamation`, 4 `SystemAsterisk`, more `SystemDefault`. The names are in the driver's data from 10h. MMSYSTEM's `sndPlaySound` plays it with `SND_ASYNC`, found by `GetProcAddress` the first time (`0055`-`00b6`); where that answers nought, or MMSYSTEM is not loaded, the speaker.
- [[read out]] USER's [[fn:USER.MessageBeep]] calls it while its `Beep` setting is on, with -1 while its system error box is up (`USER.EXE` seg1 `1bab`-`1bd0`).

## Implementation

`crates/winbox-win16/src/sound.rs`. The speaker is not sounded. The TypeScript engine's `MessageBeep` now calls it as USER does.

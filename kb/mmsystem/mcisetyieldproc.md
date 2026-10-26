---
kind: function
module: MMSYSTEM
name: mciSetYieldProc
ordinal: 714
summary: Sets the procedure an MCI device's driver calls while it waits.
versions:
  '3.1': exact
probes: [mmmisc]
records: [mci]
source: src/win16/mmsystem/mci.ts
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: a procedure set answers 1, and is what [[fn:MMSYSTEM.mciGetYieldProc]] gives, with its doubleword. Nought is refused, 0, and the procedure before stays; so is ID nought, or one not open.

## Inside Windows

- [[read out]] seg5 `2acd`: `IsBadCodePtr` of the procedure first (seg4 `51c`) -- nought is no code -- then the device; the procedure and its doubleword kept at 14h and 18h of its record.
- [[read out]] So `MCI_BREAK_OFF`, which sets nought (seg5 `bc`), leaves the break key's procedure.

## Implementation

Both engines, as read out: `src/win16/mmsystem/mci.ts` and `crates/winbox-win16/src/mmsystem/mci.rs`.

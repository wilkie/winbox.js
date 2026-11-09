---
kind: function
module: MMSYSTEM
name: mciParseCommand
ordinal: 704
summary: Exported, but a near procedure of MMSYSTEM's command parser: a far call has no answer to follow, and WinBox answers nought.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/mmsystem/mod.rs
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] No program can call it and come back: see below.
- Not measured: a far call returns into MMSYSTEM's own segment at the caller's offset.

## Inside Windows

- [[read out]] seg5 `3994`: the entry is MMSYSTEM's own command parser's front, which ends with `ret 12h`, a near return, and reads its arguments from `[bp+4]` up, as a near procedure called from within the segment does. Called far, it takes the caller's segment as its first argument's word, and returns to the caller's offset in MMSYSTEM's own segment.

## Callers

- [[read out]] MMSYSTEM's own command parser calls it near, from seg5 `0e01`. No file of the installations or the corpus imports it (`kb/data/mmsystem-callers.json`).

## Implementation

**Not applicable (c).** Only MMSYSTEM's own parser calls it, near: the entry is `enter`, the parser's arguments read from `[bp+4]` up, and `ret 12h` (seg5 `3994`-`39dd`), so a far call takes the caller's return for its first arguments and returns to the caller's offset in MMSYSTEM's segment, which is no behaviour to follow. WinBox answers what the parser answers for a command it does not parse, nought (`39bf`-`39c1`), and pop the eighteen bytes its return pops. See [[topic:user-internals]].

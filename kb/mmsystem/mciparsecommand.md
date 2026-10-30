---
kind: function
module: MMSYSTEM
name: mciParseCommand
ordinal: 704
summary: Exported, but a near procedure: a program cannot call it.
versions:
  '3.1': stub
source: src/win16/mmsystem.ts
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] No program can call it and come back: see below.

## Inside Windows

- [[read out]] seg5 `3994`: the entry is MMSYSTEM's own command parser's front, which ends with `ret 12h`, a near return, and reads its arguments from `[bp+4]` up, as a near procedure called from within the segment does. Called far, it takes the caller's segment as its first argument's word, and returns to the caller's offset in MMSYSTEM's own segment.

## Callers

- [[read out]] MMSYSTEM's own command parser calls it near, from seg5 `0e01`. No file of the installations or the corpus imports it (`kb/data/mmsystem-callers.json`).

## Implementation

Both engines keep it a stub, and it is **not applicable**: confirmed again for the coverage of the Win16 API -- the entry is `enter`, the parser's arguments read from `[bp+4]` up, and `ret 12h` (seg5 `3994`-`39dd`) -- so a far call of it takes the caller's segment for its first argument and returns to the caller's offset in MMSYSTEM's segment, which is no behaviour to follow. See [[topic:user-internals]].

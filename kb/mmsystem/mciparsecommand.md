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

## Implementation

Both engines keep it a stub: what a far call to it does is not a behaviour to be followed.

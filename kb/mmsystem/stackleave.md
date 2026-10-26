---
kind: function
module: MMSYSTEM
name: StackLeave
ordinal: 33
summary: Moves a driver back from MMSYSTEM's stack to the one it came from.
versions:
  '3.1': exact
probes: [mmmisc]
records: [stack]
source: src/win16/mmsystem/stacks.ts
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: after [[fn:MMSYSTEM.StackEnter]], on either installation, the stack is the probe's again where it was, and the carry clear.

## Inside Windows

- [[read out]] seg1 `370`: under a word of nought, the word taken away with the return; else the stack the two words on top name taken back, and the stack given back to MMSYSTEM.

## Implementation

Both engines, as read out: `src/win16/mmsystem/stacks.ts` and `crates/winbox-win16/src/mmsystem/stacks.rs`.

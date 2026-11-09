---
kind: function
module: MMSYSTEM
name: StackEnter
ordinal: 32
summary: Moves a driver at interrupt time to one of MMSYSTEM's stacks.
versions:
  '3.1': exact
probes: [mmmisc]
records: [stack]
source: crates/winbox-win16/src/mmsystem/stacks.rs
topics: [multimedia-services]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]], calling it by its ordinal from the probe's stack: with no sound driver, there are no stacks; the carry is set, the stack segment the same, and the stack two bytes deeper with a word of nought on top. With the Sound Blaster, the carry is clear, the stack another, and on top the stack pointer it came from, past its return address.

## Inside Windows

- [[read out]] seg1 `312`; the stacks, seg2 `152`. [[topic:multimedia-services]] has both.

## Implementation

Both engines, as read out: `src/win16/mmsystem/stacks.ts` and `crates/winbox-win16/src/mmsystem/stacks.rs`.

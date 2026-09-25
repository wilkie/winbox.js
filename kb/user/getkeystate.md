---
kind: function
module: USER
name: GetKeyState
ordinal: 106
summary: Whether a key was down, and whether it is toggled, as of the keyboard message a program is handling rather than the keyboard now.
versions:
  '3.1': unrecorded
source: src/win16/user/accelerators.ts
---

## Observed behaviour

- [[read out]] `USER.EXE` answers from a table of 256 bytes, one a virtual key. It loads the key's byte and sign-extends it with `CBW`. Bit 80h means down and bit 1 means toggled, so a key that is down answers `FF80h`, a toggled key answers `1`, and a key that is both answers `FF81h`.
- [[documented]] The table moves with the messages a program takes from its queue, not with the keyboard. So what `GetKeyState` says matches the key message being handled, even when the user has typed on since.

## Implementation

The table changes as `GetMessage` or `PeekMessage` takes a key message out of the queue. A key's toggle bit flips each time it goes down after being up.

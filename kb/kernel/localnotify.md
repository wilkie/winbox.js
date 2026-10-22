---
kind: function
module: KERNEL
name: LocalNotify
ordinal: 14
summary: Puts a procedure in place of the local heap's notify procedure, and answers the one before it.
versions:
  '3.1': partial
probes: [locinfo]
source: src/win16/kernel/LocalNotify.ts
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] [[probe:locinfo]] gives its own procedure: the one answered is at offset `8DE2h`, of a segment not nought. Given that back, it answers the probe's own.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg2 `0278` checks the pointer (seg2 `02cf`: nought, or code) and goes on to seg2 `28a0`, which swaps the far pointer at 1Eh of the heap's information, DS:6 pointing at it, and answers the old one.
- [[read out]] `LocalInit` puts KERNEL's own there, seg1 `8de2`. The heap calls the procedure through seg1 `8aa5`, only where its segment is not nought: with 0 when it is out of room (seg1 `92c9`), with 1 for a block it moves (`8c8d`, `8ff3`, `907b`), and with 2 for one it discards (`8bae`, `8f79`). BX and CX carry the handle or sizes.

## Implementation

Both engines swap the pointer in the heap's information, as KERNEL does.

Not yet done:

- KERNEL's own procedure's segment is its code's; WinBox's heap keeps the offset with the segment nought, so `locinfo`'s record of the segment is a known gap.
- A program's procedure is never called: the heap does what KERNEL's own would, growing the segment when out of room, whatever is there.

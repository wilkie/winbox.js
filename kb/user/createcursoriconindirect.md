---
kind: function
module: USER
name: CreateCursorIconIndirect
ordinal: 408
summary: An icon or cursor made from a header and two sets of bits.
versions:
  '3.1': exact
probes: [curmake]
records: [create]
topics: [cursor]
source: crates/winbox-win16/src/cursor_make.rs
---

## Observed behaviour

- [[measured]] [[probe:curmake]]: the header copied as given, the mask its height times its bytes a row, the picture the width times the bits a pixel rounded up to words, times the planes and the height: 16 by 16 of one plane 96 bytes, of four 192.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `0000`-`00bb`: the sizes in sixteen bits, a block of twelve bytes more allocated as the instance's (`DirectResAlloc`), the header, the mask and the picture copied in.

## Implementation

`src/win16/user/cursor-make.ts`; the Rust engine's `crates/winbox-win16/src/cursor_make.rs`. A cursor made is drawn from its block as the display shows it, a bit of its picture set flipping the screen's pixel.

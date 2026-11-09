---
kind: function
module: USER
name: CreateCursor
ordinal: 406
summary: A cursor made from a mask and a picture of one bit a pixel.
versions:
  '3.1': exact
probes: [curmake]
records: [create]
topics: [cursor]
source: crates/winbox-win16/src/cursor_make.rs
---

## Observed behaviour

- [[measured]] [[probe:curmake]]: a block of the header and the bits as given -- 32 by 32 with its hotspot at 3, 5 is 288 bytes as `GlobalSize` has it (268 asked for), its header `03 00 05 00 20 00 20 00 04 00 01 01`; 17 by 2 has 4 bytes a row.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `00be`-`010d`: a header made of the hotspot, the size, the row -- the width plus 15 with bit 3 cleared, shifted down 3 -- one plane and one bit; then [[fn:USER.CreateCursorIconIndirect]].

## Implementation

`src/win16/user/cursor-make.ts`; the Rust engine's `crates/winbox-win16/src/cursor_make.rs`. A cursor made is drawn from its block as the display shows it, a bit of its picture set flipping the screen's pixel.

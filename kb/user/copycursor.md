---
kind: function
module: USER
name: CopyCursor
ordinal: 369
summary: A cursor copied into a block of its own.
versions:
  '3.1': exact
probes: [curmake]
records: [copy]
topics: [cursor]
source: src/win16/user/cursor-make.ts
---

## Observed behaviour

- [[measured]] [[probe:curmake]]: a new handle whose bytes are the cursor's, the same size.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `02c3`: [[fn:USER.CopyIcon]]'s body (`0260`): the block locked, its parts found as `DumpIcon` finds them (`01bb`), and [[fn:USER.CreateCursorIconIndirect]] of them.

## Implementation

`src/win16/user/cursor-make.ts`; the Rust engine's `crates/winbox-win16/src/cursor_make.rs`. A cursor made is drawn from its block as the display shows it, a bit of its picture set flipping the screen's pixel.

---
kind: function
module: USER
name: DestroyCursor
ordinal: 458
summary: A cursor done with; the arrow put back first where it is the cursor now.
versions:
  '3.1': exact
probes: [curmake]
records: [destroy, current]
topics: [cursor]
source: src/win16/user/cursor-make.ts
---

## Observed behaviour

- [[measured]] [[probe:curmake]]: 1, and the block gone; the arrow current after where the cursor destroyed was; a cursor destroyed again, and nought, answer nought.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `018d`-`01b8`: where it is the cursor now (`[194h]`), the cursor set to USER's arrow (`[9A8h]`); then `FreeResource`, and whether that answered nought.

## Implementation

`src/win16/user/cursor-make.ts`; the Rust engine's `crates/winbox-win16/src/cursor_make.rs`. A cursor made is drawn from its block as the display shows it, a bit of its picture set flipping the screen's pixel.

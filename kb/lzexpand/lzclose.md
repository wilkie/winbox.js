---
kind: function
module: LZEXPAND
name: LZClose
ordinal: 6
summary: A handle let go -- an LZ handle's slot emptied, its file closed and its block freed; a DOS handle closed by _lclose.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

- [[measured]] An LZ handle let go is free for another: [[probe:lzfiles]] lets two go and opens two more, and the slots are taken again in turn.
- [[measured]] A handle out of range, an empty slot, and a DOS handle not open are let be: the calls after them answer as before.

## Nuances

- [[read out]] The argument: the handle; it pops 2 bytes and answers nothing (AX as its last call left it).

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg2 `06f0`: out of range, nothing; below 400h, `_lclose`. Else the slot emptied first, then the block locked -- nothing more where it cannot be -- its DOS handle closed, and the block unlocked and freed.

## Implementation

`lzClose` in `src/win16/lzexpand/lz.ts` and `lz_close` in `crates/winbox-win16/src/lzexpand/mod.rs` leave AX as it was.

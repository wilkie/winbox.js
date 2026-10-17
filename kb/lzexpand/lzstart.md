---
kind: function
module: LZEXPAND
name: LZStart
ordinal: 7
summary: The buffers LZCopy expands with made -- a ring and an input and an output of 8000h bytes -- the first time, and counted; 1, or -5.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

- [[measured]] 1, and 1 again: [[probe:lzfiles]] calls it twice, copies, and calls [[fn:LZEXPAND.LZDone]] three times; the copies before and after are whole.

## Nuances

- [[read out]] No arguments; it answers an `INT`.
- [[read out]] The count stops at FFFFh.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg4 `0000`: the copying buffers made current from where they are kept (`[34h]`); the first time (`[32h]` nought) made (seg1 `0000`): a ring of 1080h bytes, then an input of 8001h and an output of 8000h, `GMEM_DDESHARE | GMEM_ZEROINIT`, both 400h smaller each time either cannot be had, down to none, -5; and kept. The count goes up.

## Implementation

`lzStart` in `src/win16/lzexpand/lz.ts` and `lz_start` in `crates/winbox-win16/src/lzexpand/mod.rs` allocate the buffers with KERNEL's `GlobalAlloc`.

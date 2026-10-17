---
kind: function
module: LZEXPAND
name: WEP
ordinal: 11
summary: LZEXPAND's exit procedure -- it does nothing, its blocks and buffers left as they are.
versions:
  '3.1': unrecorded
source: src/win16/lzexpand/index.ts
topics: [compressed-files]
---

## Observed behaviour

KERNEL calls it as LZEXPAND is freed; no program calls it. Not measured.

- [[read out]] It returns at once (`LZEXPAND.DLL` seg3 `0000`), popping its word, AX the data segment its prologue loaded.

## Implementation

`WEP` in `src/win16/lzexpand/index.ts` and `wep` in `crates/winbox-win16/src/lzexpand/mod.rs` do nothing, AX as it was.

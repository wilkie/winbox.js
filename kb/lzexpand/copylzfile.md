---
kind: function
module: LZEXPAND
name: CopyLZFile
ordinal: 8
summary: LZCopy by another name -- a file copied into another, expanded.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/index.ts
topics: [compressed-files]
---

## Observed behaviour

- [[measured]] As [[fn:LZEXPAND.LZCopy]]: [[probe:lzfiles]] copies two of its files with it, a compressed one and an LZ handle partly read, and both are whole.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg4 `013a`: a call of [[fn:LZEXPAND.LZCopy]] with its two arguments; it pops 4 bytes.

## Implementation

`CopyLZFile` in `src/win16/lzexpand/index.ts` calls `lzCopy`; the Rust engine answers it with `lz_copy` (`crates/winbox-win16/src/lzexpand/mod.rs`).

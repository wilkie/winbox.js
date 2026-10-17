---
kind: function
module: LZEXPAND
name: LZSeek
ordinal: 4
summary: An LZ handle's place in the expanded file set -- from its start, its place, or its end, never before the start -- or a DOS handle's, by _llseek.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] seeks a compressed file of 20000 bytes and a plain one of 1500, and reads after each seek.

- [[measured]] From the start, the place, or the end, the new place is answered: 15000, 15100 from there, 19900 for -100 from the end; 20010 for 10 past it.
- [[measured]] Past the end is let be, and reading there gives nothing: 70000, then nought bytes.
- [[measured]] Before the start, from the start or from the place: -7, `LZERROR_BADVALUE`, the place as it was. An origin of 3 or -1: -7.
- [[measured]] A DOS handle is `_llseek`'s: -10 from the end of the plain file is 1490; -1 from the start is the file's end, as DOSBox puts it; an origin of 3 is -1.
- [[measured]] An empty slot: -6. A handle out of range: -1.

## Nuances

- [[read out]] The arguments: the handle, the offset, a `LONG`, and the origin; it pops 8 bytes and answers a `LONG`.
- [[read out]] Only the place is set: nothing is read or decoded until [[fn:LZEXPAND.LZRead]].

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg2 `02ee`: a handle below nought or past 40Fh -1; below 400h, `_llseek`. Else the block locked (-6 where it cannot be), the origin's base -- nought, the place (0Dh), the length (5) -- the offset added, a negative place -7, the place written.

## Implementation

`lzSeek` in `src/win16/lzexpand/lz.ts` and `lz_seek` in `crates/winbox-win16/src/lzexpand/mod.rs`. Both engines agree with [[probe:lzfiles]], with `LZEXPAND.DLL` on the drive and without it. [[fn:KERNEL._llseek]] follows DOSBox for a place before the start.

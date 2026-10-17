---
kind: function
module: LZEXPAND
name: LZRead
ordinal: 5
summary: Bytes of the expanded file from an LZ handle's place, through a window of the last 400h bytes made -- decoded on, or from the start again, until the place is in it -- or a DOS handle's, by _lread.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] reads each file whole in pieces, and holds every byte to the data.

- [[measured]] Pieces of 1, 7, 100, 1024, 1025, 4096 and 30000 bytes read the 20000 bytes of `BIG.DAT` whole: each read answers its piece but the last, which answers what is left, and the next nought.
- [[measured]] A file cut short: 900 bytes in pieces of 100, then -3; in one piece of 3000, -3 at once, nothing given. A header alone: -3.
- [[measured]] After [[fn:LZEXPAND.LZSeek]], the bytes at the new place, forward or back, within the window or before it.
- [[measured]] A count below nought: -7. A count of nought: nought. An empty slot: -6; a handle out of range: -1.
- [[measured]] A DOS handle reads as `_lread` does: a plain file's bytes.

## Nuances

- [[read out]] The arguments: the handle, a far pointer to the buffer, the count; it pops 8 bytes and answers an `INT`. The buffer's offset wraps within its segment.
- [[read out]] The first read of a handle, and a read before the window's start, begins the stream again from its fourteenth byte, decoding up to 16 bytes before the place; another decodes on, no more than 3F0h bytes past what was made.
- [[read out]] Where the stream ends before the place, -3: what was copied before is lost.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg2 `03d6`:

1. A handle out of range -1; a count below nought -7; a DOS handle `_lread`.
2. The block locked (-6), the first read marked (flags bit 0) and begun again, or begun again where the place is before the window; the handle's state made current (seg5 `00d0`).
3. While bytes are wanted and the place is before the end: bytes copied from the window where the place is in it; then the window emptied and the stream decoded (seg9 `0000`) with no output file, to the least of the place and the count, the length less one, and the window's reach; the window's start set to what was made less the window's fill. Nothing made, or not as far as asked, is -3.
4. The state kept in the block (seg5 `0052`); the bytes copied answered.

## Implementation

`lzRead` in `src/win16/lzexpand/lz.ts` and `lz_read` in `crates/winbox-win16/src/lzexpand/mod.rs` follow it step by step on the handle's block in global memory. Both engines agree with [[probe:lzfiles]], with `LZEXPAND.DLL` on the drive and without it.

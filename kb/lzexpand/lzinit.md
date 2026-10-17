---
kind: function
module: LZEXPAND
name: LZInit
ordinal: 3
summary: An LZ handle for a DOS handle of a file COMPRESS made, its block of buffers allocated in the next free slot; a plain file's own handle, sought back to its start.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] opens its files with `_lopen`, seeks each to 5, and gives it to `LZInit`, then asks where the DOS handle is.

- [[measured]] A compressed file: an LZ handle, 400h and its slot; the DOS handle left after the header, at 14.
- [[measured]] A plain file, a file shorter than a header, an empty one, a wrong signature: the DOS handle itself, at 0.
- [[measured]] Another algorithm: -8, the DOS handle at 14 and still open. A header alone: an LZ handle.
- [[measured]] A DOS handle not open: -1. An LZ handle: -1.

## Nuances

- [[read out]] The argument: the DOS handle; it pops 2 bytes and answers an `INT`.
- [[read out]] The header is read from the start (seg8 `00aa`): the file sought to its end for its length, kept, then to its start, then 14 bytes read. A file of 14 bytes or more whose header cannot be read is -1; a shorter one is plain.
- [[read out]] The slot is the first free from the one after the last given, wrapping; none is -5. Its block, 18A5h bytes `GMEM_MOVEABLE | GMEM_ZEROINIT` ([[topic:compressed-files]]), holds the DOS handle, the algorithm, the expanded length, the file's length and the place, nought; a block not allocated -5, not locked -6.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg2 `0000`: the header (seg8 `00aa`) and its signature (seg8 `01a2`, USER's `lstrcmp`); not COMPRESS's, `_llseek` to nought and the DOS handle answered. Else the slot found (`[30h]`), the block allocated and filled, made current (seg5 `0000`), its input and window made empty, its state kept (seg5 `0052`), and the next slot after this one.

## Implementation

`lzInit` in `src/win16/lzexpand/lz.ts` and `lz_init` in `crates/winbox-win16/src/lzexpand/mod.rs` allocate the block with KERNEL's `GlobalAlloc`, as LZEXPAND does. Both engines agree with [[probe:lzfiles]], with `LZEXPAND.DLL` on the drive and without it.

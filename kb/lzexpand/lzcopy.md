---
kind: function
module: LZEXPAND
name: LZCopy
ordinal: 1
summary: A file copied into another, expanded where COMPRESS made it — the bytes written, or an LZERROR -- from an LZ handle's file's start, whatever was read of it; the source's time given to the copy.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] copies each of its files into a new file, and reads the new file back.

- [[measured]] A compressed file is expanded whole, and the answer is the bytes written: 3000, 20000, 756 and 700 for its four, every byte the data.
- [[measured]] A plain file is copied as it is: 1500 bytes; 5 for a file shorter than a header; nought for an empty one.
- [[measured]] A file cut short: -3, `LZERROR_READ`, the copy left with what was made (nothing, its buffer never full). A header alone: -3. Another algorithm: -8. A wrong signature: copied as it is.
- [[measured]] An LZ handle is copied from its file's start, whatever [[fn:LZEXPAND.LZRead]] read of it first.
- [[measured]] A handle that is none as the output: -2, `LZERROR_BADOUTHANDLE`. An empty slot, 40Fh, or a DOS handle not open, as the source: -1.
- [[measured]] Inside a program's own [[fn:LZEXPAND.LZStart]], the same.

## Nuances

- [[read out]] The arguments: the source's handle, the output's; it pops 4 bytes and answers a `LONG`.
- [[read out]] The output is a DOS handle: it is sought to its start and written from there.
- [[read out]] The copy's time is set to the source's (DOS 5700h, then 5701h); DOSBox does not set it, so neither engine does.
- [[read out]] A handle past 40Fh is not checked: it reads past the table of slots into LZEXPAND's other data (seg4 `0185`). Not followed.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg4 `015c`:

1. [[fn:LZEXPAND.LZStart]], whose error is answered.
2. An LZ handle's DOS handle from its block; an empty slot -1, a block that cannot be locked -6.
3. The copy (seg7 `00f4`): the header read from the start (seg8 `00aa`); not readable, at 14 bytes or more, -1. COMPRESS's: algorithm `A`, else -8, and the stream decoded from byte 14 into the output through the 8000h-byte buffer (seg9 `0000`), the output sought to its start. Another: copied 8000h bytes at a time (seg7 `0000`). Then the buffer written out, the time copied, and for a compressed file the bytes made held to the header's length, else -3.
4. [[fn:LZEXPAND.LZDone]]. The answer is the bytes made (`[280h]`), or the error.

## Implementation

`lzCopy` in `src/win16/lzexpand/lz.ts` and `lz_copy` in `crates/winbox-win16/src/lzexpand/mod.rs`, through KERNEL's `_lread`, `_lwrite`, `_llseek` and `Dos3Call`. Both engines agree with [[probe:lzfiles]], with `LZEXPAND.DLL` on the drive and without it.

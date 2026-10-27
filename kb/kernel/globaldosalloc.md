---
kind: function
module: KERNEL
name: GlobalDosAlloc
ordinal: 184
summary: A fixed block in the first megabyte: its selector in AX and its real-mode segment in DX.
versions:
  '3.1': exact
probes: [kmore, galimit]
records: [dos, dosalloc]
source: src/win16/kernel/more-calls.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `139a`-`13d1`: `GlobalAlloc` with flags 8000h, KERNEL's own for the first megabyte, and the size; nought where it fails. Otherwise its base (seg1 `2261`) shifted right four is the segment, in DX, and the selector in AX.
- [[measured]] [[probe:kmore]]: the base is the segment's paragraph, below the first megabyte; `GlobalSize` is the size asked, `GlobalFlags` nought, `GlobalHandle` the selector itself, and the limit the size less one. A block of 20h after one of 100h is 10h paragraphs on, and once both are freed 20h is given at the first's segment again: blocks go lowest first, one after another. 100000h is refused; 10000h and 40000h are given.
- [[measured]] [[probe:galimit]]: nought is refused, unlike [[fn:KERNEL.GlobalAlloc]]'s nought; 1, FFFFh and 10000h bytes are given 20h, 10000h and 10000h; 100000h and everything larger, to FFFFFFFFh, are refused.
- [[read out]] The size goes through [[fn:KERNEL.GlobalAlloc]]'s own `0c7c`, so its limit is the same, FF0000h. The block is fixed, and `4025` gives a block of nought only where it is moveable (`40ab`).

## Nuances

- On Windows the first block went to segment 16D2h. Windows' low memory holds blocks of its own besides: a block of 64 KiB went past them to 3BFEh, and no more than 1400h bytes fitted below that, at 1896h. WinBox gives blocks from 16D2h to A000h with nothing of its own between, so a large block may be given lower than Windows would give it.
- The base, as `GetSelectorBase` answers it, is from where the first megabyte is: nought on Windows, the machine's in WinBox ([[topic:kernel-queries]]).
- A real-mode segment is of use to real-mode code, through DPMI's calls; WinBox runs none.

## Inside Windows

KERNEL's global heap takes in the conventional memory DOS had free as Windows started, and the flag 8000h keeps a block there. The block is fixed, and its handle is its selector.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.

---
kind: function
module: KERNEL
name: GlobalAlloc
ordinal: 15
summary: Allocates a block of the global heap and returns a handle that is its own selector at a lower privilege level.
versions:
  '3.1': exact
probes: [memory, handles, galimit]
topics: [global-and-local-memory]
---

## Observed behaviour

- [[measured]] The size is rounded up to a multiple of 32, with 32 the least: requests of 1, 2, 15, 16, 17 and 32 bytes all come back as 32, 100 as 128, and 1024, 4096 and 65536 unchanged, as [[fn:KERNEL.GlobalSize]] reports it — 17 records of [[probe:memory]].
- [[measured]] Fixed and moveable blocks round alike (fixed 1 and 16 → 32, 1024 → 1024), and `GMEM_ZEROINIT` does not change the size (100 → 128 either way).
- [[measured]] A request for zero bytes succeeds, moveable and fixed alike, and gets a real handle whose size reads 0.
- [[measured]] The handle is one less than the selector [[fn:KERNEL.GlobalLock]] returns for it, with low three bits 6 against 7, for moveable, fixed and discardable blocks — 6 records of [[probe:handles]].
- [[measured]] [[probe:galimit]]: past 1 MiB a block is rounded up to a whole 4 KiB page: 100000h bytes are given 100000h, 100001h are given 101000h. 1, FFFFh and 10000h bytes are given 20h, 10000h and 10000h. Moveable, fixed and moveable with `GMEM_DDESHARE` alike.
- [[measured]] Nothing larger than 16 MiB less 64 KiB is given, and nothing larger than the machine has room for. FF0001h, FFFFFFh, 1000000h, 1000001h, 68000000h and FFFFFFFFh bytes are refused, as are FE0000h and FF0000h on a machine with about 14 MiB free. The answer is `NULL`, and [[fn:KERNEL.GetFreeSpace]] answers as it did before. OLECLI asks for 68000000h bytes, moveable, and is refused in the same way.
- [[measured]] While a block is held, `GetFreeSpace(0)` is less by its size as given, 20h for one byte, 101000h for 100001h. Once it is freed, `GetFreeSpace(0)` is as it was.
- [[measured]] On the oracle's machine the largest block given is E34000h bytes, 1000h more is refused, and `GlobalCompact(0)` answered E24000h just before: the largest block is 10000h more than [[fn:KERNEL.GlobalCompact]] says.

## Nuances

- [[inferred]] Both values name the same local-descriptor-table entry, the handle at requested privilege level 2 and the selector at 3. A fixed block's handle is therefore not its selector, which the common account says it is.
- Not yet measured: whether `GMEM_ZEROINIT` actually zeroes the block, discardable blocks being discarded to make room, and `GMEM_NOCOMPACT` or `GMEM_NODISCARD` making a request fail sooner.
- [[measured]] The fixtures record Windows 3.1 running in standard mode. Enhanced mode has not been recorded.
- How much memory there is depends on the machine. WinBox models the oracle's, as [[probe:galimit]] recorded it: see How much there is, in [[topic:global-and-local-memory]].

## Inside Windows

[[read out]] `KRNL386.EXE` seg1. The export (`022b`) checks the flags against 8C8Dh only to report a bad parameter, and goes on to `0d2f`. That takes the size through `0c7c`: rounded up to 16 bytes, and made 7FFFFFFFh where it carries past 32 bits or comes to more than FF0000h, 16 MiB less 64 KiB, the most a block's 255 selectors reach. `4025` refuses more than FF0000h at once: it logs `ERR_GALLOC` through `LogError` (ordinal 324, `94cf`) and answers nought. A size of nought is given as a handle with no memory where the block is moveable (`40ab`); a program's fixed request is made moveable by `0c7c`. Any other size goes to `379e`, which rounds it with `3fde` (32 bytes, past 1 MiB a 4 KiB page) and looks for a free block. Not finding one, it asks DPMI for more memory (`397e`: function 0501h, the size rounded to a page and at least 20000h, then the largest DPMI has), compacts the heap (`34c4`) and discards what it can (`2f28`), and looks again. When nothing is found it answers nought, and so does `GlobalAlloc`.

## Implementation

The allocator rounds as `3fde` does, keeps zero as zero, and takes one 64 KiB selector per 64 KiB or part of it. It records the flags and the selector count, which [[fn:KERNEL.GlobalFlags]] and [[fn:KERNEL.GlobalReAlloc]] read back. A size `0c7c` does not let through, or one larger than the modelled machine's largest block, is refused with `NULL` (`GlobalHeap` in `crates/winbox-machine/src/global.rs`). WinBox does not compact or discard to make room. What the caller gets is the handle for the index. See [[topic:global-and-local-memory]].

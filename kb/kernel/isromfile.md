---
kind: function
module: KERNEL
name: IsROMFile
ordinal: 326
summary: Whether a file is in ROM — never, on a Windows run from the disk: nought.
source: crates/winbox-win16/src/kernel.rs
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `1ea0`-`1ea2` (`KRNL286.EXE` seg2 `1e9c`): `xor ax,ax; retf 6`. Six bytes popped, AX nought.
- [[read out]] No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

`IsRomFile` in `src/win16/kernel/misc.ts`: nought, as KERNEL answers. See [[topic:kernel-internals]].
